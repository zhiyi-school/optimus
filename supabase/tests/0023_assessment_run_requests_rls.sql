-- Queue, claim and retry checks for durable assessment run requests
-- (migration 0023).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0023 assessment run request checks passed". Each assertion below names what
-- it proves. All identifiers are placeholders.

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
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'developer-b@example.test'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'cio@example.test'),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'security@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team A', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Developer Team B', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';
update profiles set team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', roles = array['developer']
  where id = '22222222-2222-2222-2222-222222222222';
update profiles set team_id = null, roles = array['cio']
  where id = '33333333-3333-3333-3333-333333333333';
update profiles set team_id = null, roles = array['security']
  where id = '44444444-4444-4444-4444-444444444444';

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app_a', 'Example Application A', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a0000000-0000-0000-0000-00000000000b', 'example_app_b', 'Example Application B', 'android',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into assessments (id, external_id, application_id, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'manual::example_app_a',
   'a0000000-0000-0000-0000-00000000000a', 'queued'),
  ('b0000000-0000-0000-0000-00000000000b', 'manual::example_app_b',
   'a0000000-0000-0000-0000-00000000000b', 'queued'),
  ('b0000000-0000-0000-0000-00000000000c', 'run-1::example_app_a',
   'a0000000-0000-0000-0000-00000000000a', 'completed');

-- ---------------------------------------------------------------------------
-- Only the security team may queue a run, and only where it has access
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ select request_assessment_run('b0000000-0000-0000-0000-00000000000a') $sql$,
  'a developer cannot queue an assessment run'
);

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');

select pg_temp.assert_refused(
  $sql$ select request_assessment_run('b0000000-0000-0000-0000-00000000000a') $sql$,
  'the CIO cannot queue an assessment run'
);

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert_refused(
  $sql$ select request_assessment_run('00000000-0000-0000-0000-0000000000ff') $sql$,
  'an assessment that does not exist cannot be queued'
);

select pg_temp.assert_refused(
  $sql$ select request_assessment_run('b0000000-0000-0000-0000-00000000000c') $sql$,
  'a completed assessment is never queued again'
);

-- ---------------------------------------------------------------------------
-- One active request per assessment, however often it is asked for
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  (request_assessment_run('b0000000-0000-0000-0000-00000000000a')).status = 'queued',
  'security queues an assessment for automated testing'
);

select request_assessment_run('b0000000-0000-0000-0000-00000000000a');
select request_assessment_run('b0000000-0000-0000-0000-00000000000a');

select pg_temp.assert(
  (select count(*) from assessment_run_requests
     where assessment_id = 'b0000000-0000-0000-0000-00000000000a') = 1,
  'asking three times still leaves one request, so a double click cannot queue two runs'
);

select pg_temp.act_as_owner();

select pg_temp.assert_refused(
  $sql$ insert into assessment_run_requests (assessment_id, application_id, platform, status)
        values ('b0000000-0000-0000-0000-00000000000a',
                'a0000000-0000-0000-0000-00000000000a', 'ios', 'queued') $sql$,
  'a second active request for one assessment is refused by the database itself'
);

-- ---------------------------------------------------------------------------
-- Claiming is atomic, and a claimed request is not re-queued by a retry
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  (claim_assessment_run_request('worker-a', 900)).status = 'claimed',
  'a worker claims a queued request'
);

select pg_temp.assert(
  claim_assessment_run_request('worker-b', 900) is null,
  'a second worker polling at the same time finds nothing to claim'
);

select pg_temp.assert(
  (select attempts from assessment_run_requests
     where assessment_id = 'b0000000-0000-0000-0000-00000000000a') = 1,
  'claiming counts the attempt'
);

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert(
  (request_assessment_run('b0000000-0000-0000-0000-00000000000a')).status = 'claimed',
  'retrying a request a worker already holds returns it untouched, starting nothing new'
);

select pg_temp.act_as_owner();

select pg_temp.assert(
  (select worker_id from assessment_run_requests
     where assessment_id = 'b0000000-0000-0000-0000-00000000000a') = 'worker-a',
  'and leaves the worker holding it'
);

-- ---------------------------------------------------------------------------
-- A retry wakes a waiting request rather than opening another
-- ---------------------------------------------------------------------------

update assessment_run_requests
set status = 'waiting',
    blocker_code = 'no_device',
    last_error = 'No test device is connected.',
    next_attempt_at = now() + interval '10 minutes',
    worker_id = null
where assessment_id = 'b0000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select request_assessment_run('b0000000-0000-0000-0000-00000000000a');
select pg_temp.act_as_owner();

select pg_temp.assert(
  (select count(*) from assessment_run_requests
     where assessment_id = 'b0000000-0000-0000-0000-00000000000a') = 1,
  'a manual retry reuses the waiting request instead of creating a second one'
);

select pg_temp.assert(
  (select status from assessment_run_requests
     where assessment_id = 'b0000000-0000-0000-0000-00000000000a') = 'queued'
  and (select blocker_code from assessment_run_requests
         where assessment_id = 'b0000000-0000-0000-0000-00000000000a') is null
  and (select next_attempt_at <= now() from assessment_run_requests
         where assessment_id = 'b0000000-0000-0000-0000-00000000000a'),
  'and clears its blocker and brings the next attempt forward'
);

-- ---------------------------------------------------------------------------
-- An abandoned worker does not strand the request
-- ---------------------------------------------------------------------------

update assessment_run_requests
set status = 'running',
    worker_id = 'worker-gone',
    lease_expires_at = now() - interval '1 minute'
where assessment_id = 'b0000000-0000-0000-0000-00000000000a';

select pg_temp.assert(
  recover_expired_assessment_run_leases() = 1,
  'a request whose worker lease expired is recovered'
);

select pg_temp.assert(
  (select status from assessment_run_requests
     where assessment_id = 'b0000000-0000-0000-0000-00000000000a') = 'queued'
  and (select worker_id from assessment_run_requests
         where assessment_id = 'b0000000-0000-0000-0000-00000000000a') is null
  and (select blocker_code from assessment_run_requests
         where assessment_id = 'b0000000-0000-0000-0000-00000000000a') = 'lease_expired',
  'and goes back on the queue for another worker, saying why'
);

select pg_temp.assert(
  recover_expired_assessment_run_leases() = 0,
  'recovery leaves a healthy lease alone'
);

-- ---------------------------------------------------------------------------
-- A finished request frees the assessment for a later one
-- ---------------------------------------------------------------------------

update assessment_run_requests set status = 'completed', completed_at = now()
where assessment_id = 'b0000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select request_assessment_run('b0000000-0000-0000-0000-00000000000a');
select pg_temp.act_as_owner();

select pg_temp.assert(
  (select count(*) from assessment_run_requests
     where assessment_id = 'b0000000-0000-0000-0000-00000000000a') = 2,
  'once a request has finished, the assessment can be queued again'
);

-- ---------------------------------------------------------------------------
-- Reading and writing through the dashboard
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (select count(*) from assessment_run_requests) = 2,
  'a developer sees the requests for their own team''s application'
);

-- No update policy exists, so this matches no row at all rather than raising:
-- the proof is that nothing changed.
update assessment_run_requests set status = 'cancelled'
where assessment_id = 'b0000000-0000-0000-0000-00000000000a';

select pg_temp.assert(
  (select count(*) from assessment_run_requests where status = 'cancelled') = 0
  and (select count(*) from assessment_run_requests where status = 'completed') = 1,
  'a developer cannot write to the queue directly'
);

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select pg_temp.assert(
  (select count(*) from assessment_run_requests) = 0,
  'a developer on another team sees none of them'
);

select pg_temp.assert_refused(
  $sql$ select request_assessment_run('b0000000-0000-0000-0000-00000000000a') $sql$,
  'and cannot queue a run on another team''s application'
);

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert(
  (select count(*) from assessment_run_requests) = 2,
  'security sees every request'
);

select pg_temp.assert_refused(
  $sql$ insert into assessment_run_requests (assessment_id, application_id, platform)
        values ('b0000000-0000-0000-0000-00000000000b',
                'a0000000-0000-0000-0000-00000000000b', 'android') $sql$,
  'not even security can insert into the queue by hand'
);

select pg_temp.act_as_owner();

-- ---------------------------------------------------------------------------
-- The assessment lifecycle
-- ---------------------------------------------------------------------------

update assessments set status = 'waiting' where id = 'b0000000-0000-0000-0000-00000000000b';
select pg_temp.assert(
  (select status from assessments where id = 'b0000000-0000-0000-0000-00000000000b') = 'waiting',
  'a queued assessment may start waiting on a device'
);

update assessments set status = 'running' where id = 'b0000000-0000-0000-0000-00000000000b';
update assessments set status = 'completed' where id = 'b0000000-0000-0000-0000-00000000000b';
select pg_temp.assert(
  (select status from assessments where id = 'b0000000-0000-0000-0000-00000000000b') = 'completed',
  'a waiting assessment runs and completes'
);

select pg_temp.assert_refused(
  $sql$ update assessments set status = 'running'
        where id = 'b0000000-0000-0000-0000-00000000000b' $sql$,
  'a completed assessment cannot be pushed back into running by stale state'
);

select pg_temp.assert_refused(
  $sql$ update assessments set status = 'completed'
        where id = 'b0000000-0000-0000-0000-00000000000a' $sql$,
  'a queued assessment cannot jump straight to completed'
);

update assessments set status = 'failed' where id = 'b0000000-0000-0000-0000-00000000000a';
update assessments set status = 'queued' where id = 'b0000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from assessments where id = 'b0000000-0000-0000-0000-00000000000a') = 'queued',
  'a failed assessment can be queued again rather than replaced'
);

do $$ begin raise notice '0023 assessment run request checks passed'; end $$;

rollback;
