-- Lets an already-assessed app be assessed again, of a chosen iOS build version,
-- and records the version each assessment tested. Adds
-- assessment_run_requests.build_version and assessments.app_version,
-- request_new_assessment(), and makes request_assessment_run() keep a request's
-- build version on retry. Safe to run on a fresh install, whose baseline already
-- has these definitions. See
-- docs/database-maintenance.md#build-versions-on-assessments-0041.

alter table assessments add column if not exists app_version text;

comment on column assessments.app_version is
  'The app build version this assessment tested, written by the dashboard sync from the run. Null until a run is synced, and on assessments synced before versions were recorded.';

alter table assessment_run_requests add column if not exists build_version text;

comment on column assessment_run_requests.build_version is
  'The iOS build version the run must test. Null lets the automation host test the app''s highest version.';

-- Queues an assessment run for the backend worker, reusing an outstanding request and keeping the build version it was started for; security only.
create or replace function request_assessment_run(p_assessment_id uuid) returns assessment_run_requests
language plpgsql security definer set search_path = public as $$
declare
  a assessments;
  app applications;
  existing assessment_run_requests;
begin
  if auth.uid() is null or not has_role('security') then
    raise exception 'only the security team can start an assessment run';
  end if;

  select * into a from assessments where id = p_assessment_id;
  if not found then
    raise exception 'this assessment no longer exists';
  end if;
  if not can_access_assessment(a.id) then
    raise exception 'this assessment is outside your access';
  end if;
  if a.status = 'completed' then
    raise exception 'this assessment has already completed';
  end if;

  select * into app from applications where id = a.application_id;
  if not found then
    raise exception 'this assessment has no application';
  end if;

  select * into existing from assessment_run_requests
  where assessment_id = a.id
    and status in ('queued', 'waiting', 'claimed', 'running')
  for update;

  if found then
    -- A claimed or running request is left exactly as it is, so a repeated
    -- retry cannot start a second run.
    if existing.status in ('queued', 'waiting') then
      update assessment_run_requests
      set status = 'queued',
          next_attempt_at = now(),
          blocker_code = null,
          last_error = null
      where id = existing.id
      returning * into existing;
    end if;
    return existing;
  end if;

  -- A retry tests the same build the assessment was started for.
  insert into assessment_run_requests
    (assessment_id, application_id, platform, status, requested_by, build_version)
  values (
    a.id, app.id, app.platform, 'queued', auth.uid(),
    (select r.build_version from assessment_run_requests r
     where r.assessment_id = a.id order by r.created_at desc limit 1)
  )
  returning * into existing;

  if a.status = 'failed' then
    update assessments set status = 'queued', updated_at = now() where id = a.id;
  end if;

  return existing;
end;
$$;

-- Starts a new assessment of an application, optionally of one iOS build version, and queues its run; security only.
create or replace function request_new_assessment(p_application_id uuid, p_build_version text default null) returns assessments
language plpgsql security definer set search_path = public as $$
declare
  app applications;
  previous assessments;
  created assessments;
  version text := nullif(btrim(p_build_version), '');
begin
  if auth.uid() is null or not has_role('security') then
    raise exception 'only the security team can start an assessment';
  end if;

  -- Locking the application serialises two requests for it, so only one assessment is ever in progress.
  select * into app from applications where id = p_application_id for update;
  if not found then
    raise exception 'this application no longer exists';
  end if;
  if not can_access_application(app.id) then
    raise exception 'this application is outside your access';
  end if;
  if version is not null and app.platform <> 'ios' then
    raise exception 'only iOS assessments test a chosen build version';
  end if;
  if exists (
    select 1 from assessments
    where application_id = app.id and status in ('queued', 'waiting', 'running')
  ) then
    raise exception 'this application already has an assessment in progress';
  end if;

  select * into previous from assessments
  where application_id = app.id
  order by created_at desc
  limit 1;

  insert into assessments (external_id, application_id, status, total_tests, completed_tests)
  values ('manual::' || gen_random_uuid(), app.id, 'queued', coalesce(previous.total_tests, 0), 0)
  returning * into created;

  insert into assessment_run_requests
    (assessment_id, application_id, platform, status, requested_by, build_version)
  values (created.id, app.id, app.platform, 'queued', auth.uid(), version);

  return created;
end;
$$;

revoke all on function request_new_assessment(uuid, text) from public, anon;
grant execute on function request_new_assessment(uuid, text) to authenticated, service_role;
