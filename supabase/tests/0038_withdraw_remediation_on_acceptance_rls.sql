-- Accepting a risk withdraws its open remediation (fix 0038).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0038 remediation withdrawn on acceptance checks passed". Each assertion below
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
   'authenticated', 'authenticated', 'developer-a2@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id in ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app', 'Example Application', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into assessments (id, external_id, application_id, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'run::example',
   'a0000000-0000-0000-0000-00000000000a', 'completed');

insert into findings (id, application_id, assessment_id, test_id, latest_test_run_id, title,
                      severity, status, platform)
values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01', 'example-run-1',
   'Example finding', 'high', 'at_risk', 'ios'),
  ('f0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-02', 'example-run-1',
   'Example second finding', 'high', 'at_risk', 'ios');

insert into risk_conversations (id, application_id, origin_assessment_id, risk_id, finding_id)
values
  ('d0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01',
   'f0000000-0000-0000-0000-00000000000a'),
  ('d0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-02',
   'f0000000-0000-0000-0000-00000000000b');

insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id, selected_control_id) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
   'Remediate: Example finding', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01-control-01'),
  ('c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000b',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'under_review',
   'Remediate: Example second finding', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000b', null);

insert into ticket_controls (id, ticket_id, control_id, status) values
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'example-feature-01-risk-01-control-01', 'in_progress');

-- ---------------------------------------------------------------------------
-- Accepting withdraws the open remediation and keeps its progress
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
create temporary table acceptance on commit drop as
  select accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
    'f0000000-0000-0000-0000-00000000000a', 'Compensated by server-side checks',
    'e2000000-0000-0000-0000-000000000001') as payload;

select pg_temp.act_as_owner();

select pg_temp.assert(
  (select status = 'withdrawn' and withdrawal_reason = 'Risk accepted'
          and withdrawn_by = '11111111-1111-1111-1111-111111111111'
          and withdrawn_at is not null and closed_at is null
     from tickets where id = 'c0000000-0000-0000-0000-000000000001'),
  'accepting withdraws the open remediation as the developer, with the reason Risk accepted'
);

select pg_temp.assert(
  (select selected_control_id from tickets where id = 'c0000000-0000-0000-0000-000000000001')
    = 'example-feature-01-risk-01-control-01'
  and exists (select 1 from ticket_controls where id = 'c1000000-0000-0000-0000-000000000001'),
  'the withdrawn remediation keeps its approach and progress'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'd0000000-0000-0000-0000-00000000000a'
       and kind = 'remediation_withdrawn' and message = 'Risk accepted'
       and source_ticket_id = 'c0000000-0000-0000-0000-000000000001') = 1,
  'the withdrawal is recorded in the conversation'
);

select pg_temp.assert(
  (select seq from risk_conversation_entries where kind = 'risk_accepted')
    < (select seq from risk_conversation_entries where kind = 'remediation_withdrawn'),
  'the withdrawal reads after the acceptance that caused it'
);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
  'f0000000-0000-0000-0000-00000000000a', 'Compensated by server-side checks',
  'e2000000-0000-0000-0000-000000000001');

select pg_temp.act_as_owner();
select pg_temp.assert(
  (select count(*) from risk_conversation_entries where kind = 'remediation_withdrawn') = 1,
  'a retried acceptance withdraws nothing twice'
);

-- ---------------------------------------------------------------------------
-- A remediation security is reviewing is left to security
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select accept_risk_entry('d0000000-0000-0000-0000-00000000000b',
  'f0000000-0000-0000-0000-00000000000b', 'Accepted while under review',
  'e2000000-0000-0000-0000-000000000002');

select pg_temp.act_as_owner();
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000002') = 'under_review',
  'accepting leaves a remediation under security review unchanged'
);

-- ---------------------------------------------------------------------------
-- After a retraction the developer may resume the remediation
-- ---------------------------------------------------------------------------

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
select retract_risk_acceptance(((select payload from acceptance) -> 'acceptance' ->> 'id')::uuid,
  'The server-side check was removed');

select pg_temp.act_as_owner();
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'withdrawn',
  'retracting the acceptance leaves the remediation withdrawn'
);

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
update tickets set status = 'in_progress', updated_at = now()
  where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.act_as_owner();
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'in_progress',
  'a developer can resume the remediation once the acceptance is retracted'
);

select pg_temp.assert(
  (select prosrc like '%withdrawal constant text := ''Risk accepted''%'
     from pg_proc where proname = 'accept_risk_entry'),
  'the effective accept_risk_entry withdraws remediation'
);

do $$ begin raise notice '0038 remediation withdrawn on acceptance checks passed'; end $$;

rollback;
