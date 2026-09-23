-- Reassessment eligibility once a remediation ticket stopped being a condition
-- (migration 0031).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0031 reassessment without remediation checks passed". Each assertion below
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
   'authenticated', 'authenticated', 'developer@example.test'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
   'authenticated', 'authenticated', 'unrelated@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Other Team', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';
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

-- ---------------------------------------------------------------------------
-- A developer with no remediation at all may still ask
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

insert into retest_runs (id, conversation_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
        'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs where id = 'e0000000-0000-0000-0000-000000000001') = 1,
  'a developer with no remediation ticket can request a reassessment'
);

select pg_temp.assert(
  (select ticket_id from retest_runs where id = 'e0000000-0000-0000-0000-000000000001') is null,
  'the request is recorded against no ticket at all'
);

select pg_temp.assert(
  (select previous_ticket_status from retest_runs where id = 'e0000000-0000-0000-0000-000000000001')
    is null,
  'there is no remediation state to record'
);

-- A second request is still allowed while the first is outstanding.
insert into retest_runs (id, conversation_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000a',
        'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs
     where conversation_id = 'd0000000-0000-0000-0000-00000000000a' and status = 'queued') = 2,
  'a ticketless reassessment can be queued behind another'
);

-- ---------------------------------------------------------------------------
-- Withdrawal works with nothing to restore
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  (select status from withdraw_reassessment('e0000000-0000-0000-0000-000000000002',
                                            'Asked by mistake')) = 'cancelled',
  'a ticketless reassessment can be withdrawn without a remediation to restore'
);

select pg_temp.assert(
  exists (select 1 from risk_conversation_entries
          where conversation_id = 'd0000000-0000-0000-0000-00000000000a'
            and kind = 'retest_withdrawn'),
  'the withdrawal is still recorded in the risk conversation'
);

-- ---------------------------------------------------------------------------
-- Application access is still the boundary
-- ---------------------------------------------------------------------------

select pg_temp.act_as('77777777-7777-7777-7777-777777777777');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a',
                'f0000000-0000-0000-0000-00000000000a',
                '77777777-7777-7777-7777-777777777777', 'queued') $sql$,
  'a developer outside the application cannot request a reassessment on it'
);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (finding_id, requested_by, status)
        values ('f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'a reassessment with neither a ticket nor a conversation is still refused'
);

-- ---------------------------------------------------------------------------
-- A request that does name a ticket must name a remediation
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id) values
  ('c0000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'risk_acceptance', 'open',
   'Accept: Example finding', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000a');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000009',
                'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'a reassessment still cannot be linked to a ticket that is not a remediation'
);

-- ---------------------------------------------------------------------------
-- A remediation in any state is now eligible
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'open',
   'Remediate: no approach chosen', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000a');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs where id = 'e0000000-0000-0000-0000-000000000003') = 1,
  'a remediation with no selected approach is no longer a barrier'
);

do $$ begin raise notice '0031 reassessment without remediation checks passed'; end $$;

rollback;
