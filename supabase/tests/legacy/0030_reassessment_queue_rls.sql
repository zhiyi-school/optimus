-- Several outstanding reassessment requests per risk, run one at a time
-- (migration 0030).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0030 reassessment queue checks passed". Each assertion below names what
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
   'authenticated', 'authenticated', 'developer@example.test'),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'security@example.test'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
   'authenticated', 'authenticated', 'unrelated@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Other Team', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';
update profiles set team_id = null, roles = array['security']
  where id = '44444444-4444-4444-4444-444444444444';
update profiles set team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', roles = array['developer']
  where id = '77777777-7777-7777-7777-777777777777';

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app', 'Example Application', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into assessments (id, external_id, application_id, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'run::example',
   'a0000000-0000-0000-0000-00000000000a', 'completed');

insert into findings (id, application_id, assessment_id, test_id, title, severity, status, platform)
values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01',
   'Example finding', 'high', 'at_risk', 'ios');

insert into risk_conversations (id, application_id, origin_assessment_id, risk_id, finding_id)
values
  ('d0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01',
   'f0000000-0000-0000-0000-00000000000a');

-- One remediation still in progress, with a selected approach.
insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id, selected_control_id) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
   'Remediate: Example finding', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01-control-01');


-- A second security reviewer, so two concurrent starts can be attempted.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555',
   'authenticated', 'authenticated', 'security2@example.test');
update profiles set team_id = null, roles = array['security']
  where id = '55555555-5555-5555-5555-555555555555';

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- Each intentional submission is its own request; a retry is not
-- ---------------------------------------------------------------------------

select request_reassessment_entry(
  'd0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
  'c0000000-0000-0000-0000-000000000001', 'First look please.',
  '99990000-0000-0000-0000-000000000001') as first_submission \gset

select pg_temp.assert(
  (select count(*) from retest_runs where conversation_id = 'd0000000-0000-0000-0000-00000000000a') = 1,
  'the first submission creates one request'
);

-- The same submission id, as a retry of a lost response.
select request_reassessment_entry(
  'd0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
  'c0000000-0000-0000-0000-000000000001', 'First look please.',
  '99990000-0000-0000-0000-000000000001');

select pg_temp.assert(
  (select count(*) from retest_runs where conversation_id = 'd0000000-0000-0000-0000-00000000000a') = 1,
  'retrying the same submission adds no second request'
);
select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'd0000000-0000-0000-0000-00000000000a'
       and kind = 'retest_requested') = 1,
  'and adds no second conversation event'
);

-- A new intentional Send, with identical text.
select request_reassessment_entry(
  'd0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
  'c0000000-0000-0000-0000-000000000001', 'First look please.',
  '99990000-0000-0000-0000-000000000002');

select pg_temp.assert(
  (select count(*) from retest_runs where conversation_id = 'd0000000-0000-0000-0000-00000000000a') = 2,
  'identical text with a new submission id is a second request'
);
select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'd0000000-0000-0000-0000-00000000000a'
       and kind = 'retest_requested') = 2,
  'each request gets its own conversation event'
);
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'retest_requested',
  'the remediation is awaiting reassessment while requests are queued'
);

-- ---------------------------------------------------------------------------
-- Security runs them one at a time, oldest first
-- ---------------------------------------------------------------------------

select id into temporary table queue_order
from retest_runs
where conversation_id = 'd0000000-0000-0000-0000-00000000000a'
order by created_at, id;

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert_refused(
  format($sql$ select start_reassessment(%L) $sql$,
         (select id from queue_order offset 1 limit 1)),
  'the newer request cannot jump ahead of the older one'
);

select start_reassessment((select id from queue_order limit 1));

select pg_temp.assert(
  (select status from retest_runs where id = (select id from queue_order limit 1)) = 'running',
  'the oldest queued request starts'
);
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'retest_in_progress',
  'starting a request moves the remediation to verification in progress'
);

select pg_temp.act_as('55555555-5555-5555-5555-555555555555');
select pg_temp.assert_refused(
  format($sql$ select start_reassessment(%L) $sql$,
         (select id from queue_order offset 1 limit 1)),
  'a second security reviewer cannot start another run for the same risk'
);

select pg_temp.assert(
  (select count(*) from retest_runs
     where conversation_id = 'd0000000-0000-0000-0000-00000000000a' and status = 'running') = 1,
  'only one reassessment for the risk is ever running'
);

-- Adding another request must not pull the running ticket back.
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select request_reassessment_entry(
  'd0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
  'c0000000-0000-0000-0000-000000000001', 'One more.',
  '99990000-0000-0000-0000-000000000003');

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'retest_in_progress',
  'queueing another request does not downgrade a running remediation'
);

-- ---------------------------------------------------------------------------
-- Finishing one request leaves the others alone
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
update retest_runs
set status = 'completed', result = 'Reduced Risk', completed_at = now()
where id = (select id from queue_order limit 1);
select reconcile_reassessment_ticket_state('c0000000-0000-0000-0000-000000000001');

select pg_temp.assert(
  (select count(*) from retest_runs
     where conversation_id = 'd0000000-0000-0000-0000-00000000000a' and status = 'queued') = 2,
  'completing one request leaves the queued ones queued'
);
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'retest_requested',
  'the remediation waits again rather than going under review while requests remain'
);

-- ---------------------------------------------------------------------------
-- Ownership, access and linkage still hold
-- ---------------------------------------------------------------------------

select pg_temp.act_as('77777777-7777-7777-7777-777777777777');
select pg_temp.assert_refused(
  $sql$ select request_reassessment_entry(
          'd0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
          'c0000000-0000-0000-0000-000000000001', 'Not mine.',
          '99990000-0000-0000-0000-0000000000ff') $sql$,
  'a developer outside the application cannot queue a request'
);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- Another developer reusing someone else's submission id gets their own request.
select pg_temp.assert(
  (select requested_by from retest_runs
     where submission_id = '99990000-0000-0000-0000-000000000001') = '11111111-1111-1111-1111-111111111111',
  'a submission id never transfers ownership of an existing request'
);

select pg_temp.act_as_owner();
update tickets set status = 'closed' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ select request_reassessment_entry(
          'd0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
          'c0000000-0000-0000-0000-000000000001', 'Too late.',
          '99990000-0000-0000-0000-000000000004') $sql$,
  'a remediation security has finalised still refuses a new request'
);

select pg_temp.assert(
  (select reconcile_reassessment_ticket_state('c0000000-0000-0000-0000-000000000001')) = 'closed',
  'reconciliation never reopens a finalised remediation'
);

do $$ begin raise notice '0030 reassessment queue checks passed'; end $$;

rollback;
