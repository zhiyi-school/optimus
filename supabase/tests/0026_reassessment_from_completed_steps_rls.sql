-- Completion and authorization checks for requesting a reassessment without a
-- fix submission (migration 0026).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0026 reassessment readiness checks passed". Each assertion below names what
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
   'authenticated', 'authenticated', 'security@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';
update profiles set team_id = null, roles = array['security']
  where id = '44444444-4444-4444-4444-444444444444';

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

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- Nothing recorded yet
-- ---------------------------------------------------------------------------

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'a reassessment is refused while the selected approach has no recorded progress'
);

insert into ticket_controls (id, ticket_id, control_id, status) values
  ('11110000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'example-feature-01-risk-01-control-01', 'in_progress');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'a reassessment is refused while the approach has no steps at all'
);

insert into ticket_control_steps (id, ticket_control_id, step_key, status) values
  ('22220000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001',
   'example-step-one', 'completed'),
  ('22220000-0000-0000-0000-000000000002', '11110000-0000-0000-0000-000000000001',
   'example-step-two', 'not_started');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'a reassessment is refused while any step of the selected approach is outstanding'
);

-- ---------------------------------------------------------------------------
-- Completed steps, requested straight from an in-progress remediation
-- ---------------------------------------------------------------------------

update ticket_control_steps set status = 'completed', completed_by = auth.uid(), completed_at = now()
  where id = '22220000-0000-0000-0000-000000000002';

insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs where id = 'e0000000-0000-0000-0000-000000000001') = 1,
  'a reassessment is allowed from in_progress once every step is completed, with no fix submission'
);

select pg_temp.assert(
  (select previous_ticket_status from retest_runs
   where id = 'e0000000-0000-0000-0000-000000000001') = 'in_progress',
  'the request records in_progress as the state to restore on withdrawal'
);

update tickets set status = 'retest_requested'
  where id = 'c0000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Withdrawal puts it back where the request found it
-- ---------------------------------------------------------------------------

select withdraw_reassessment('e0000000-0000-0000-0000-000000000001', 'Reworking the fix.');

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'in_progress',
  'withdrawing restores the remediation to in_progress, not to a fix submission'
);

select pg_temp.assert(
  (select status from retest_runs where id = 'e0000000-0000-0000-0000-000000000001') = 'cancelled',
  'the withdrawn request is cancelled rather than deleted'
);

-- ---------------------------------------------------------------------------
-- A remediation security already holds
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id, selected_control_id) values
  ('c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'under_review',
   'Remediate: Example finding (under review)', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01-control-01');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
                'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'a reassessment is refused on a remediation security is already verifying'
);

-- ---------------------------------------------------------------------------
-- A remediation recorded before this change is not stranded
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id, selected_control_id) values
  ('c0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'fix_submitted',
   'Remediate: Example finding (legacy)', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01-control-01');
insert into ticket_controls (id, ticket_id, control_id, status) values
  ('11110000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003',
   'example-feature-01-risk-01-control-01', 'completed');
insert into ticket_control_steps (id, ticket_control_id, step_key, status) values
  ('22220000-0000-0000-0000-000000000003', '11110000-0000-0000-0000-000000000003',
   'example-step-one', 'completed');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select previous_ticket_status from retest_runs
   where id = 'e0000000-0000-0000-0000-000000000003') = 'fix_submitted',
  'a remediation recorded before this change can still be reassessed'
);

-- ---------------------------------------------------------------------------
-- Security is not held to the developer's completion rule
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id) values
  ('c0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
   'Remediate: Example finding (security)', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000a');
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000a',
        '44444444-4444-4444-4444-444444444444', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs where id = 'e0000000-0000-0000-0000-000000000004') = 1,
  'security can still run a reassessment of its own without a completed checklist'
);

do $$ begin raise notice '0026 reassessment readiness checks passed'; end $$;

rollback;
