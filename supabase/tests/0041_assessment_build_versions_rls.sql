-- New-assessment and build-version checks (fix 0041).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0041 assessment build version checks passed". Each assertion below names
-- what it proves. All identifiers are placeholders.

begin;

create or replace function pg_temp.act_as(user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.act_as_owner() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.assert(condition boolean, description text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'FAILED: %', description;
  end if;
  raise notice 'ok: %', description;
end;
$$;

create or replace function pg_temp.assert_refused(statement text, description text) returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    raise notice 'ok: % (refused: %)', description, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % — the statement was allowed', description;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'developer-a@example.test'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'cio@example.test'),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'security@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team A', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';
update profiles set team_id = null, roles = array['cio']
  where id = '33333333-3333-3333-3333-333333333333';
update profiles set team_id = null, roles = array['security']
  where id = '44444444-4444-4444-4444-444444444444';

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_ios_app', 'Example iOS Application', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a0000000-0000-0000-0000-00000000000b', 'example_android_app', 'Example Android Application', 'android',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into assessments (id, external_id, application_id, status, total_tests, completed_tests) values
  ('b0000000-0000-0000-0000-00000000000a', 'run-1::example_ios_app',
   'a0000000-0000-0000-0000-00000000000a', 'completed', 5, 5),
  ('b0000000-0000-0000-0000-00000000000b', 'run-1::example_android_app',
   'a0000000-0000-0000-0000-00000000000b', 'completed', 4, 4);

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'assessments'
            and column_name = 'app_version' and data_type = 'text' and is_nullable = 'YES')
  and exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'assessment_run_requests'
                and column_name = 'build_version' and data_type = 'text' and is_nullable = 'YES'),
  'assessments record a tested version and run requests a requested one'
);

-- ---------------------------------------------------------------------------
-- Only the security team starts a new assessment
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select pg_temp.assert_refused(
  $sql$ select request_new_assessment('a0000000-0000-0000-0000-00000000000a', '4.3.4') $sql$,
  'a developer cannot start a new assessment'
);

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
select pg_temp.assert_refused(
  $sql$ select request_new_assessment('a0000000-0000-0000-0000-00000000000a', '4.3.4') $sql$,
  'the CIO cannot start a new assessment'
);

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select pg_temp.assert_refused(
  $sql$ select request_new_assessment('00000000-0000-0000-0000-0000000000ff', null) $sql$,
  'an application that does not exist cannot be assessed'
);
select pg_temp.assert_refused(
  $sql$ select request_new_assessment('a0000000-0000-0000-0000-00000000000b', '5.0') $sql$,
  'an Android assessment cannot choose a build version'
);

-- ---------------------------------------------------------------------------
-- A new assessment of a chosen version, alongside the completed one
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  (request_new_assessment('a0000000-0000-0000-0000-00000000000a', ' 3.9.9 ')).status = 'queued',
  'security starts a new assessment of an already-assessed app'
);

select pg_temp.assert(
  (select count(*) from assessments where application_id = 'a0000000-0000-0000-0000-00000000000a') = 2
  and (select status from assessments where id = 'b0000000-0000-0000-0000-00000000000a') = 'completed',
  'the earlier assessment is kept as it was'
);

select pg_temp.assert(
  (select external_id like 'manual::%' and total_tests = 5 and completed_tests = 0
   from assessments
   where application_id = 'a0000000-0000-0000-0000-00000000000a' and status = 'queued'),
  'the new assessment is a placeholder sized like the last one'
);

select pg_temp.assert(
  (select r.build_version from assessment_run_requests r
   join assessments a on a.id = r.assessment_id
   where a.application_id = 'a0000000-0000-0000-0000-00000000000a' and a.status = 'queued') = '3.9.9',
  'its run request names the chosen version, trimmed'
);

select pg_temp.assert_refused(
  $sql$ select request_new_assessment('a0000000-0000-0000-0000-00000000000a', '4.3.4') $sql$,
  'a second assessment cannot start while one is in progress'
);

select pg_temp.assert(
  (request_new_assessment('a0000000-0000-0000-0000-00000000000b', '   ')).status = 'queued'
  and (select r.build_version from assessment_run_requests r
       join assessments a on a.id = r.assessment_id
       where a.application_id = 'a0000000-0000-0000-0000-00000000000b' and a.status = 'queued') is null,
  'a blank version on Android lets the host test what is installed'
);

-- ---------------------------------------------------------------------------
-- A retry keeps the version the assessment was started for
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
update assessment_run_requests set status = 'failed', completed_at = now()
where assessment_id = (select id from assessments
                       where application_id = 'a0000000-0000-0000-0000-00000000000a' and status = 'queued');
update assessments set status = 'failed'
where application_id = 'a0000000-0000-0000-0000-00000000000a' and status = 'queued';

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select pg_temp.assert(
  (request_assessment_run((select id from assessments
                           where application_id = 'a0000000-0000-0000-0000-00000000000a'
                             and status = 'failed'))).build_version = '3.9.9',
  'retrying a failed assessment requests the same build version'
);

-- ---------------------------------------------------------------------------
-- The function is callable only when signed in
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
select pg_temp.assert(
  has_function_privilege('authenticated', 'public.request_new_assessment(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.request_new_assessment(uuid,text)', 'EXECUTE'),
  'signed-in users may call request_new_assessment and anonymous callers may not'
);

do $$ begin raise notice '0041 assessment build version checks passed'; end $$;

rollback;
