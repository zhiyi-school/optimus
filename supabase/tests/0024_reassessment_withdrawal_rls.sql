-- Authorization, atomicity and race checks for withdrawing a queued
-- reassessment (migration 0024).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0024 reassessment withdrawal checks passed". Each assertion below names what
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
   'authenticated', 'authenticated', 'developer-c@example.test'),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'security@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team A', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Developer Team B', 'developer');

-- developer-a and developer-b share team A; developer-c is on team B.
update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
update profiles set team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', roles = array['developer']
  where id = '33333333-3333-3333-3333-333333333333';
update profiles set team_id = null, roles = array['security']
  where id = '44444444-4444-4444-4444-444444444444';

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app_a', 'Example Application A', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into assessments (id, external_id, application_id, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'run::example-a',
   'a0000000-0000-0000-0000-00000000000a', 'completed');

insert into findings (id, application_id, assessment_id, test_id, title, severity, status, platform)
values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01',
   'Example finding A', 'high', 'at_risk', 'ios');

insert into risk_conversations (id, application_id, origin_assessment_id, risk_id, finding_id)
values
  ('d0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01',
   'f0000000-0000-0000-0000-00000000000a');

insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'fix_submitted',
   'Remediate: Example finding A', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'rejected',
   'Remediate: Example finding A (changes requested)',
   '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------------------
-- Requesting records the state it interrupted
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select previous_ticket_status from retest_runs
   where id = 'e0000000-0000-0000-0000-000000000001') = 'fix_submitted',
  'requesting from a submitted fix records fix_submitted as the state to restore'
);

update tickets set status = 'retest_requested'
  where id = 'c0000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Only the requester, and only while queued
-- ---------------------------------------------------------------------------

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select pg_temp.assert_refused(
  $sql$ select withdraw_reassessment('e0000000-0000-0000-0000-000000000001', 'Not mine.') $sql$,
  'another developer on the same team cannot withdraw a request they did not make'
);

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
select pg_temp.assert_refused(
  $sql$ select withdraw_reassessment('e0000000-0000-0000-0000-000000000001', 'Not my team.') $sql$,
  'a developer on another team cannot withdraw it'
);

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select pg_temp.assert_refused(
  $sql$ select withdraw_reassessment('e0000000-0000-0000-0000-000000000001', 'Security says so.') $sql$,
  'security cannot use the developer withdrawal path'
);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select pg_temp.assert_refused(
  $sql$ select withdraw_reassessment('e0000000-0000-0000-0000-000000000001', '   ') $sql$,
  'a whitespace-only reason is refused'
);

-- RLS gives the developer no update policy at all, so a direct write matches no
-- row rather than raising: what matters is that nothing changed.
update retest_runs set status = 'cancelled'
  where id = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.assert(
  (select status from retest_runs where id = 'e0000000-0000-0000-0000-000000000001') = 'queued',
  'a developer cannot cancel the row directly, bypassing the function'
);

-- ---------------------------------------------------------------------------
-- The authorised withdrawal, and what it restores
-- ---------------------------------------------------------------------------

select withdraw_reassessment('e0000000-0000-0000-0000-000000000001',
                             '  Found another defect in the same flow.  ');

select pg_temp.assert(
  (select status from retest_runs where id = 'e0000000-0000-0000-0000-000000000001') = 'cancelled',
  'the requester withdraws their own queued reassessment'
);

select pg_temp.assert(
  (select cancellation_reason from retest_runs
   where id = 'e0000000-0000-0000-0000-000000000001') = 'Found another defect in the same flow.',
  'the reason is trimmed and recorded'
);

select pg_temp.assert(
  (select cancelled_by from retest_runs where id = 'e0000000-0000-0000-0000-000000000001')
    = '11111111-1111-1111-1111-111111111111'
  and (select cancelled_at from retest_runs
       where id = 'e0000000-0000-0000-0000-000000000001') is not null,
  'the actor and the moment are recorded'
);

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'fix_submitted',
  'the remediation is restored to fix_submitted in the same call'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
   where kind = 'retest_withdrawn'
     and sync_key = 'retest-withdrawn::e0000000-0000-0000-0000-000000000001') = 1,
  'the withdrawal adds exactly one conversation event'
);

select withdraw_reassessment('e0000000-0000-0000-0000-000000000001', 'Retrying the same call.');

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
   where sync_key = 'retest-withdrawn::e0000000-0000-0000-0000-000000000001') = 1,
  'retrying the withdrawal does not duplicate the event'
);

select pg_temp.assert(
  (select cancellation_reason from retest_runs
   where id = 'e0000000-0000-0000-0000-000000000001') = 'Found another defect in the same flow.',
  'a repeated withdrawal leaves the original record untouched'
);

select pg_temp.assert(
  (select withdrawn_at from tickets where id = 'c0000000-0000-0000-0000-000000000001') is null,
  'withdrawing the reassessment does not withdraw the remediation'
);

select pg_temp.assert(
  not exists (
    select 1 from retest_runs
    where conversation_id = 'd0000000-0000-0000-0000-00000000000a'
      and status in ('queued', 'running')
  ),
  'a cancelled request no longer counts as an active reassessment'
);

-- ---------------------------------------------------------------------------
-- A new request afterwards, restoring a rejected fix this time
-- ---------------------------------------------------------------------------

insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs
   where conversation_id = 'd0000000-0000-0000-0000-00000000000a' and status = 'queued') = 1,
  'a new reassessment can be requested once the previous one was withdrawn'
);

select pg_temp.act_as_owner();
update tickets set status = 'rejected' where id = 'c0000000-0000-0000-0000-000000000002';
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

insert into retest_runs (id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002',
        'f0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select previous_ticket_status from retest_runs
   where id = 'e0000000-0000-0000-0000-000000000003') = 'rejected',
  'requesting from a rejected fix records rejected as the state to restore'
);

update tickets set status = 'retest_requested'
  where id = 'c0000000-0000-0000-0000-000000000002';

select withdraw_reassessment('e0000000-0000-0000-0000-000000000003', 'Reworking the fix.');

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000002') = 'rejected',
  'the remediation is restored to rejected, not to fix_submitted'
);

-- ---------------------------------------------------------------------------
-- Legacy rows, running rows and finished rows
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status,
                         previous_ticket_status)
values ('e0000000-0000-0000-0000-000000000004', null,
        'c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued', null);
-- A row created before this migration recorded nothing; the request trigger
-- fills the column in now, so it is cleared to reproduce the older shape.
update retest_runs set previous_ticket_status = null
  where id = 'e0000000-0000-0000-0000-000000000004';
update tickets set status = 'retest_requested'
  where id = 'c0000000-0000-0000-0000-000000000002';
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select withdraw_reassessment('e0000000-0000-0000-0000-000000000004', 'Withdrawing a legacy request.');

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000002') = 'fix_submitted',
  'a request predating the recorded state falls back to fix_submitted'
);

select pg_temp.act_as_owner();
update tickets set status = 'retest_requested'
  where id = 'c0000000-0000-0000-0000-000000000001';
update retest_runs set status = 'running'
  where id = 'e0000000-0000-0000-0000-000000000002';
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ select withdraw_reassessment('e0000000-0000-0000-0000-000000000002', 'Too late.') $sql$,
  'a running reassessment cannot be withdrawn'
);

select pg_temp.act_as_owner();
update retest_runs set status = 'completed'
  where id = 'e0000000-0000-0000-0000-000000000002';
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ select withdraw_reassessment('e0000000-0000-0000-0000-000000000002', 'Too late.') $sql$,
  'a completed reassessment cannot be withdrawn'
);

select pg_temp.act_as_owner();
update retest_runs set status = 'failed'
  where id = 'e0000000-0000-0000-0000-000000000002';
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ select withdraw_reassessment('e0000000-0000-0000-0000-000000000002', 'Too late.') $sql$,
  'a failed reassessment cannot be withdrawn'
);

-- ---------------------------------------------------------------------------
-- Starting and withdrawing cannot both win
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status,
                         previous_ticket_status)
values ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued', 'fix_submitted');

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select start_reassessment('e0000000-0000-0000-0000-000000000005');

select pg_temp.assert(
  (select status from retest_runs where id = 'e0000000-0000-0000-0000-000000000005') = 'running',
  'security claims the queued request before any automation is started'
);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select pg_temp.assert_refused(
  $sql$ select withdraw_reassessment('e0000000-0000-0000-0000-000000000005', 'Racing the start.') $sql$,
  'withdrawal loses cleanly once the start has claimed the request'
);

select pg_temp.act_as_owner();
insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status,
                         previous_ticket_status)
values ('e0000000-0000-0000-0000-000000000006', null,
        'c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued', 'fix_submitted');
update tickets set status = 'retest_requested'
  where id = 'c0000000-0000-0000-0000-000000000002';

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select withdraw_reassessment('e0000000-0000-0000-0000-000000000006', 'Withdrawing first.');

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select pg_temp.assert_refused(
  $sql$ select start_reassessment('e0000000-0000-0000-0000-000000000006') $sql$,
  'the start loses cleanly once the withdrawal has cancelled the request'
);

-- ---------------------------------------------------------------------------
-- Cancellation metadata is only ever valid together
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();

select pg_temp.assert_refused(
  $sql$ update retest_runs set status = 'cancelled'
        where id = 'e0000000-0000-0000-0000-000000000005' $sql$,
  'a cancelled row without an actor, time and reason is refused'
);

select pg_temp.assert_refused(
  $sql$ update retest_runs
        set cancelled_at = now(), cancelled_by = '11111111-1111-1111-1111-111111111111',
            cancellation_reason = 'Not cancelled at all.'
        where id = 'e0000000-0000-0000-0000-000000000005' $sql$,
  'cancellation details on a request that is not cancelled are refused'
);

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (ticket_id, finding_id, requested_by, status,
                                 previous_ticket_status)
        values ('c0000000-0000-0000-0000-000000000001',
                'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued', 'closed') $sql$,
  'a previous ticket status outside the restorable states is refused'
);

select pg_temp.assert(
  (select count(*) from retest_runs
   where status in ('queued', 'running', 'completed', 'failed', 'cancelled'))
    = (select count(*) from retest_runs),
  'every historical reassessment still satisfies the widened status check'
);

do $$ begin raise notice '0024 reassessment withdrawal checks passed'; end $$;

rollback;
