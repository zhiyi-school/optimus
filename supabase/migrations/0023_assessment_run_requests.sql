-- Durable assessment execution requests. See docs/data-model.md for the design.

begin;

alter table assessments drop constraint if exists assessments_status_check;
alter table assessments add constraint assessments_status_check
  check (status in ('queued', 'waiting', 'running', 'completed', 'failed'));

create or replace function enforce_assessment_status_transition() returns trigger
language plpgsql as $$
declare
  legal constant jsonb := jsonb_build_object(
    'queued',    jsonb_build_array('queued', 'waiting', 'running', 'failed'),
    'waiting',   jsonb_build_array('waiting', 'queued', 'running', 'failed'),
    'running',   jsonb_build_array('running', 'completed', 'failed', 'queued'),
    'completed', jsonb_build_array('completed', 'queued'),
    'failed',    jsonb_build_array('failed', 'queued', 'waiting', 'running')
  );
begin
  if new.status = old.status then
    return new;
  end if;
  if not (legal -> old.status) ? new.status then
    raise exception 'an assessment cannot move from % to %', old.status, new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_assessment_status_transition on assessments;
create trigger trg_enforce_assessment_status_transition
  before update of status on assessments
  for each row execute function enforce_assessment_status_transition();

create table if not exists assessment_run_requests (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  status text not null default 'queued' check (
    status in ('queued', 'waiting', 'claimed', 'running', 'completed', 'failed', 'cancelled')
  ),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  worker_id text,
  blocker_code text,
  last_error text,
  requested_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create unique index if not exists assessment_run_requests_one_active
  on assessment_run_requests (assessment_id)
  where status in ('queued', 'waiting', 'claimed', 'running');

create index if not exists idx_assessment_run_requests_claimable
  on assessment_run_requests (status, next_attempt_at);

create index if not exists idx_assessment_run_requests_assessment
  on assessment_run_requests (assessment_id);

create or replace trigger trg_assessment_run_requests_updated_at
  before update on assessment_run_requests
  for each row execute function set_updated_at();

alter table assessment_run_requests enable row level security;

drop policy if exists assessment_run_requests_select on assessment_run_requests;
create policy assessment_run_requests_select on assessment_run_requests
  for select to authenticated
  using (can_access_assessment(assessment_id));

-- No insert, update or delete policy: every write goes through the functions
-- below, so the state machine and the one-active rule cannot be bypassed.

create or replace function request_assessment_run(p_assessment_id uuid)
returns assessment_run_requests
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

  insert into assessment_run_requests
    (assessment_id, application_id, platform, status, requested_by)
  values (a.id, app.id, app.platform, 'queued', auth.uid())
  returning * into existing;

  if a.status = 'failed' then
    update assessments set status = 'queued', updated_at = now() where id = a.id;
  end if;

  return existing;
end;
$$;

revoke all on function request_assessment_run(uuid) from public;
grant execute on function request_assessment_run(uuid) to authenticated;

-- `skip locked` is what makes two workers polling at once safe: each takes a
-- different row instead of blocking on the same one.
create or replace function claim_assessment_run_request(
  p_worker_id text,
  p_lease_seconds integer default 900
)
returns assessment_run_requests
language plpgsql security definer set search_path = public as $$
declare
  claimed assessment_run_requests;
begin
  select * into claimed from assessment_run_requests
  where status in ('queued', 'waiting')
    and next_attempt_at <= now()
  order by next_attempt_at, created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update assessment_run_requests
  set status = 'claimed',
      attempts = attempts + 1,
      claimed_at = now(),
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      worker_id = p_worker_id
  where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$$;

revoke all on function claim_assessment_run_request(text, integer) from public;

create or replace function recover_expired_assessment_run_leases()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  recovered integer;
begin
  update assessment_run_requests
  set status = 'queued',
      claimed_at = null,
      lease_expires_at = null,
      worker_id = null,
      blocker_code = 'lease_expired',
      next_attempt_at = now()
  where status in ('claimed', 'running')
    and lease_expires_at is not null
    and lease_expires_at < now();
  get diagnostics recovered = row_count;
  return recovered;
end;
$$;

revoke all on function recover_expired_assessment_run_leases() from public;

-- 0022 replaced this function without the two write-once guards 0021 added, so
-- they are restored here. They sit before the security early-return because a
-- ticket's conversation and originating assessment are records of where the
-- work began, not permissions.
create or replace function enforce_ticket_update_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  developer_statuses constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'retest_requested', 'withdrawn'];
  withdrawable_from constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'rejected'];
  security_finalised constant text[] := array['closed', 'accepted'];
  selectable_from constant text[] := array['open', 'in_progress', 'fix_submitted', 'rejected'];
  withdrawing constant boolean :=
    new.status = 'withdrawn' and old.status is distinct from 'withdrawn';
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;

  if old.risk_conversation_id is not null
    and new.risk_conversation_id is distinct from old.risk_conversation_id then
    raise exception 'a ticket keeps the risk conversation it was opened against';
  end if;

  if old.origin_assessment_id is not null
    and new.origin_assessment_id is not null
    and new.origin_assessment_id is distinct from old.origin_assessment_id then
    raise exception 'a ticket keeps the assessment it was opened against';
  end if;

  if has_role('security') or has_role('admin') then
    return new;
  end if;

  if old.status = any(security_finalised) then
    raise exception 'only the security team can reopen a ticket it has finalised';
  end if;

  if new.status is distinct from old.status and not (new.status = any(developer_statuses)) then
    raise exception 'only the security team can move a ticket to %', new.status;
  end if;

  if old.status = 'withdrawn'
    and new.status is distinct from old.status
    and new.status <> 'in_progress' then
    raise exception 'a withdrawn remediation ticket resumes as in_progress';
  end if;

  if new.selected_control_id is distinct from old.selected_control_id then
    if new.type is distinct from 'remediation' then
      raise exception 'only a remediation ticket has a remediation approach';
    end if;
    if not (old.status = any(selectable_from)) then
      raise exception 'the remediation approach cannot be changed once security verification has started';
    end if;
  end if;

  if withdrawing then
    if new.type is distinct from 'remediation' then
      raise exception 'only a remediation ticket can be withdrawn';
    end if;
    if not (old.status = any(withdrawable_from)) then
      raise exception 'a remediation ticket cannot be withdrawn once security verification has started';
    end if;
    if coalesce(btrim(new.withdrawal_reason), '') = '' then
      raise exception 'withdrawing a remediation ticket needs a reason';
    end if;
    if new.withdrawn_by is distinct from auth.uid() then
      raise exception 'the developer withdrawing the ticket must be recorded as withdrawn_by';
    end if;
    if new.withdrawn_at is null then
      raise exception 'withdrawing a remediation ticket must record withdrawn_at';
    end if;
  elsif new.withdrawn_at is distinct from old.withdrawn_at
    or new.withdrawn_by is distinct from old.withdrawn_by
    or new.withdrawal_reason is distinct from old.withdrawal_reason then
    raise exception 'withdrawal details are recorded once, when the ticket is withdrawn';
  end if;

  if new.closed_at is distinct from old.closed_at then
    raise exception 'only the security team can close or reopen a ticket';
  end if;

  if new.type is distinct from old.type
    or new.finding_id is distinct from old.finding_id
    or new.application_id is distinct from old.application_id
    or new.created_by is distinct from old.created_by
    or new.assigned_team_id is distinct from old.assigned_team_id
    or new.assigned_user_id is distinct from old.assigned_user_id then
    raise exception 'only the security team can change a ticket''s ownership fields';
  end if;

  return new;
end;
$$;

commit;
