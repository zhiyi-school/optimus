-- The retired `fix_submitted` ticket status (migration 0032).
--
-- Run through `npm run test:database`, which applies it to a disposable
-- database only. It creates its own fixtures and ends with `rollback`. A failed
-- assertion raises and aborts; a clean run prints "0032 retire fix_submitted
-- checks passed". All identifiers are placeholders.

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
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'security@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';
update profiles set roles = array['security']
  where id = '22222222-2222-2222-2222-222222222222';

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

insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     assigned_team_id, risk_conversation_id) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
   'Remediate: Example finding', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd0000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------------------
-- The status can no longer be stored
-- ---------------------------------------------------------------------------

select pg_temp.assert_refused(
  $sql$ insert into tickets (finding_id, application_id, type, status, title, created_by)
        values ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
                'remediation', 'fix_submitted', 'Retired state',
                '11111111-1111-1111-1111-111111111111') $sql$,
  'even the owner cannot create a fix_submitted ticket'
);

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, finding_id, requested_by, status,
                                 previous_ticket_status)
        values ('d0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued', 'fix_submitted') $sql$,
  'a reassessment cannot record fix_submitted as the state to restore'
);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'fix_submitted'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'a developer cannot move a remediation to fix_submitted'
);

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'fix_submitted'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'security cannot move a remediation to fix_submitted either'
);

-- ---------------------------------------------------------------------------
-- Withdrawing a request with no recorded state restores in_progress
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
update tickets set status = 'retest_requested' where id = 'c0000000-0000-0000-0000-000000000001';
insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select previous_ticket_status from retest_runs where id = 'e0000000-0000-0000-0000-000000000001')
    is null,
  'a request made while already waiting records no state to restore'
);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (select status from withdraw_reassessment('e0000000-0000-0000-0000-000000000001',
                                            'Asked too early')) = 'cancelled',
  'the developer can withdraw the request'
);

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'in_progress',
  'with no recorded state the remediation resumes as in_progress, not fix_submitted'
);

-- ---------------------------------------------------------------------------
-- Current workflows still work from in_progress
-- ---------------------------------------------------------------------------

insert into retest_runs (id, conversation_id, ticket_id, finding_id, requested_by, status)
values ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select previous_ticket_status from retest_runs where id = 'e0000000-0000-0000-0000-000000000002')
    = 'in_progress',
  'a request from in_progress still records in_progress to restore'
);

select pg_temp.act_as_owner();
update retest_runs
set status = 'cancelled', cancelled_at = now(),
    cancelled_by = '11111111-1111-1111-1111-111111111111', cancellation_reason = 'Fixture cleanup'
where id = 'e0000000-0000-0000-0000-000000000002';
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

update tickets
set status = 'withdrawn', withdrawn_at = now(),
    withdrawn_by = '11111111-1111-1111-1111-111111111111', withdrawal_reason = 'No longer needed'
where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'withdrawn',
  'a developer can still withdraw an in_progress remediation'
);

-- ---------------------------------------------------------------------------
-- Conversation history keeps its old events, but no new ones are recorded
-- ---------------------------------------------------------------------------

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_entries (conversation_id, kind, author_id, message)
        values ('d0000000-0000-0000-0000-00000000000a', 'fix_submitted',
                '11111111-1111-1111-1111-111111111111', 'Done') $sql$,
  'a developer can no longer record a fix_submitted event'
);

insert into risk_conversation_entries (conversation_id, kind, author_id, message)
values ('d0000000-0000-0000-0000-00000000000a', 'message',
        '11111111-1111-1111-1111-111111111111', 'Still working on it');

select pg_temp.assert(
  exists (select 1 from risk_conversation_entries
          where conversation_id = 'd0000000-0000-0000-0000-00000000000a' and kind = 'message'),
  'a developer can still post an ordinary message'
);

select pg_temp.act_as_owner();

insert into risk_conversation_entries (conversation_id, kind, author_id, message)
values ('d0000000-0000-0000-0000-00000000000a', 'fix_submitted',
        '11111111-1111-1111-1111-111111111111', 'Historical event');

select pg_temp.assert(
  exists (select 1 from risk_conversation_entries
          where conversation_id = 'd0000000-0000-0000-0000-00000000000a' and kind = 'fix_submitted'),
  'fix_submitted remains a legal historical event kind'
);

-- ---------------------------------------------------------------------------
-- The effective workflow functions no longer name the retired state
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('enforce_ticket_update_permissions', 'enforce_retest_request_permissions',
                       'withdraw_reassessment')
     and p.prosrc like '%fix_submitted%') = 0,
  'no ticket workflow function sets, restores or accepts fix_submitted'
);

do $$ begin raise notice '0032 retire fix_submitted checks passed'; end $$;

rollback;
