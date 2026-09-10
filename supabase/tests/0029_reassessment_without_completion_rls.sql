-- Reassessment eligibility once remediation progress stopped being a condition
-- (migration 0029).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0029 reassessment eligibility checks passed". Each assertion below names what
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


select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- Progress is no longer a condition
-- ---------------------------------------------------------------------------

insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs where id = 'e0000000-0000-0000-0000-000000000001') = 1,
  'a reassessment is allowed with no recorded progress at all'
);

select pg_temp.assert(
  (select previous_ticket_status from retest_runs where id = 'e0000000-0000-0000-0000-000000000001')
    = 'in_progress',
  'the request still records the state the remediation was in'
);

select pg_temp.act_as_owner();
delete from retest_runs where id = 'e0000000-0000-0000-0000-000000000001';

insert into ticket_controls (id, ticket_id, control_id, status) values
  ('11110000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'example-feature-01-risk-01-control-01', 'in_progress');
insert into ticket_control_steps (id, ticket_control_id, step_key, status) values
  ('22220000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001',
   'example-step-one', 'completed'),
  ('22220000-0000-0000-0000-000000000002', '11110000-0000-0000-0000-000000000001',
   'example-step-two', 'not_started');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs where id = 'e0000000-0000-0000-0000-000000000002') = 1,
  'a reassessment is allowed with only some steps completed'
);

select pg_temp.assert(
  (select count(*) from ticket_control_steps
     where ticket_control_id = '11110000-0000-0000-0000-000000000001'
       and status = 'completed') = 1,
  'requesting a reassessment leaves the recorded progress exactly as it was'
);

-- ---------------------------------------------------------------------------
-- Everything else 0026 enforced still holds
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
delete from retest_runs where id = 'e0000000-0000-0000-0000-000000000002';
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a',
                'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'a reassessment still cannot be requested without a remediation ticket'
);

select pg_temp.act_as_owner();
insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id) values
  ('c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
   'Remediate: no approach chosen', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000a');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
                'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'the selected-approach requirement survives the completion change'
);

select pg_temp.act_as_owner();
update tickets set status = 'closed' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'a remediation security has finalised still refuses a reassessment'
);

select pg_temp.act_as_owner();
update tickets set status = 'in_progress' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.act_as('77777777-7777-7777-7777-777777777777');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                'f0000000-0000-0000-0000-00000000000a',
                '77777777-7777-7777-7777-777777777777', 'queued') $sql$,
  'a developer outside the application is still refused'
);

-- A historical fix_submitted remediation stays eligible.
select pg_temp.act_as_owner();
update tickets set status = 'fix_submitted' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select previous_ticket_status from retest_runs where id = 'e0000000-0000-0000-0000-000000000003')
    = 'fix_submitted',
  'a historical fix_submitted remediation is still eligible and still recorded'
);

do $$ begin raise notice '0029 reassessment eligibility checks passed'; end $$;

rollback;
