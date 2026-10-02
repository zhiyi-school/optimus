-- Run-id checks for assessment run requests (fix 0036).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0036 assessment run request run id checks passed". Each assertion below
-- names what it proves. All identifiers are placeholders.

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

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'developer-a@example.test'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'developer-b@example.test'),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'security@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team A', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Developer Team B', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';
update profiles set team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', roles = array['developer']
  where id = '22222222-2222-2222-2222-222222222222';
update profiles set team_id = null, roles = array['security']
  where id = '44444444-4444-4444-4444-444444444444';

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app_a', 'Example Application A', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into assessments (id, external_id, application_id, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'manual::example_app_a',
   'a0000000-0000-0000-0000-00000000000a', 'queued');

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_run_requests'
      and column_name = 'run_id' and data_type = 'text' and is_nullable = 'YES'
  ),
  'run requests carry an optional text run_id'
);

-- ---------------------------------------------------------------------------
-- A new request has no run until the worker starts one
-- ---------------------------------------------------------------------------

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert(
  (request_assessment_run('b0000000-0000-0000-0000-00000000000a')).run_id is null,
  'a freshly queued request has no run yet'
);

-- ---------------------------------------------------------------------------
-- The worker records the run; readers see it, clients cannot write it
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();

update assessment_run_requests
set status = 'completed', completed_at = now(), run_id = 'example-run-1'
where assessment_id = 'b0000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (select run_id from assessment_run_requests
   where assessment_id = 'b0000000-0000-0000-0000-00000000000a') = 'example-run-1',
  'a developer with access reads the run the request started'
);

update assessment_run_requests set run_id = 'tampered'
where assessment_id = 'b0000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

update assessment_run_requests set run_id = 'tampered'
where assessment_id = 'b0000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select pg_temp.assert(
  not exists (select 1 from assessment_run_requests
              where assessment_id = 'b0000000-0000-0000-0000-00000000000a'),
  'a developer outside the application cannot see its run'
);

select pg_temp.act_as_owner();

select pg_temp.assert(
  (select run_id from assessment_run_requests
   where assessment_id = 'b0000000-0000-0000-0000-00000000000a') = 'example-run-1',
  'neither a developer nor security can rewrite the recorded run'
);

do $$ begin raise notice '0036 assessment run request run id checks passed'; end $$;

rollback;
