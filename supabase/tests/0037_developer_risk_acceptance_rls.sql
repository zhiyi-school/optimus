-- Developer risk acceptance, retraction and its ending on Reduced Risk (fix 0037).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0037 developer risk acceptance checks passed". Each assertion below
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
   'authenticated', 'authenticated', 'developer-a2@example.test'),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'security@example.test'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
   'authenticated', 'authenticated', 'developer-b@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Other Team', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id in ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');
update profiles set team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', roles = array['developer']
  where id = '77777777-7777-7777-7777-777777777777';
update profiles set team_id = null, roles = array['security']
  where id = '44444444-4444-4444-4444-444444444444';

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
   'Example finding', 'high', 'at_risk', 'ios');

insert into risk_conversations (id, application_id, origin_assessment_id, risk_id, finding_id)
values
  ('d0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01',
   'f0000000-0000-0000-0000-00000000000a');

insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'open',
   'Remediate: Example finding', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000a');

-- Two outstanding reassessments: one started by security, one still queued.
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select request_reassessment_entry('d0000000-0000-0000-0000-00000000000a',
  'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  'Fixed in build 2', 'e1000000-0000-0000-0000-000000000001');
select request_reassessment_entry('d0000000-0000-0000-0000-00000000000a',
  'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  'Also fixed in build 3', 'e1000000-0000-0000-0000-000000000002');

-- Both requests share the transaction's timestamp, so the queue orders them by id.
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select start_reassessment((
  select id from retest_runs
  where conversation_id = 'd0000000-0000-0000-0000-00000000000a' and status = 'queued'
  order by created_at, id
  limit 1
));

select pg_temp.act_as_owner();
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001')
    = 'retest_in_progress',
  'the fixture remediation is waiting on a running reassessment'
);

-- ---------------------------------------------------------------------------
-- Who may accept
-- ---------------------------------------------------------------------------

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select pg_temp.assert_refused(
  $sql$ select accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
          'f0000000-0000-0000-0000-00000000000a', 'Security accepting',
          'e2000000-0000-0000-0000-000000000009') $sql$,
  'the security team does not accept risks from the conversation'
);

select pg_temp.act_as('77777777-7777-7777-7777-777777777777');
select pg_temp.assert_refused(
  $sql$ select accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
          'f0000000-0000-0000-0000-00000000000a', 'Not my application',
          'e2000000-0000-0000-0000-000000000008') $sql$,
  'a developer outside the application cannot accept its risk'
);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select pg_temp.assert_refused(
  $sql$ select accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
          'f0000000-0000-0000-0000-00000000000a', '   ',
          'e2000000-0000-0000-0000-000000000007') $sql$,
  'accepting a risk needs a reason'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_acceptance (ticket_id, finding_id, requested_by, reason, decision)
        values ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'Direct write', 'accepted') $sql$,
  'a client cannot write an accepted risk directly'
);

-- ---------------------------------------------------------------------------
-- Accepting cancels outstanding reassessments and records the acceptance
-- ---------------------------------------------------------------------------

create temporary table first_acceptance on commit drop as
  select accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
    'f0000000-0000-0000-0000-00000000000a', 'Compensated by server-side checks',
    'e2000000-0000-0000-0000-000000000001') as payload;

select pg_temp.act_as_owner();

select pg_temp.assert(
  (select count(*) from risk_acceptance
     where finding_id = 'f0000000-0000-0000-0000-00000000000a'
       and decision = 'accepted' and ended_at is null
       and accepted_status = 'at_risk' and accepted_run_id = 'example-run-1'
       and conversation_id = 'd0000000-0000-0000-0000-00000000000a') = 1,
  'the acceptance is in force and records the result it accepted'
);

select pg_temp.assert(
  (select t.type = 'risk_acceptance' and t.status = 'accepted'
     from risk_acceptance a join tickets t on t.id = a.ticket_id
     where a.id = ((select payload from first_acceptance) -> 'acceptance' ->> 'id')::uuid),
  'the acceptance has an accepted risk-acceptance ticket'
);

select pg_temp.assert(
  (select count(*) from retest_runs
     where finding_id = 'f0000000-0000-0000-0000-00000000000a'
       and status = 'cancelled'
       and cancellation_reason = 'Cancelled because the risk was accepted.') = 2
  and not exists (select 1 from retest_runs
                  where finding_id = 'f0000000-0000-0000-0000-00000000000a'
                    and status in ('queued', 'running')),
  'accepting cancels the queued and the running reassessment'
);

-- This suite also runs at 0037, where the remediation is restored; from 0038 it
-- is then withdrawn, which that fix's suite asserts.
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001')
    not in ('retest_requested', 'retest_in_progress'),
  'the remediation is no longer waiting on the cancelled reassessments'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'd0000000-0000-0000-0000-00000000000a'
       and kind = 'retest_withdrawn') = 2,
  'each cancelled reassessment is recorded in the conversation'
);

select pg_temp.assert(
  (select id from risk_conversation_entries
     where conversation_id = 'd0000000-0000-0000-0000-00000000000a'
       and kind = 'risk_accepted'
       and message = 'Compensated by server-side checks'
       and author_id = '11111111-1111-1111-1111-111111111111')
    = ((select payload from first_acceptance) ->> 'entry_id')::uuid,
  'the acceptance is recorded in the conversation and its entry is returned'
);

select pg_temp.assert(
  (select seq from risk_conversation_entries where kind = 'risk_accepted')
    < (select min(seq) from risk_conversation_entries where kind = 'retest_withdrawn'),
  'the acceptance reads before the cancellations it caused'
);

-- ---------------------------------------------------------------------------
-- Retries, a second acceptance and reassessment while accepted
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
     'f0000000-0000-0000-0000-00000000000a', 'Compensated by server-side checks',
     'e2000000-0000-0000-0000-000000000001') -> 'acceptance' ->> 'id')
    = ((select payload from first_acceptance) -> 'acceptance' ->> 'id'),
  'a retried submission resolves to the acceptance it already made'
);

select pg_temp.act_as_owner();
select pg_temp.assert(
  (select count(*) from risk_acceptance where finding_id = 'f0000000-0000-0000-0000-00000000000a') = 1
  and (select count(*) from risk_conversation_entries where kind = 'risk_accepted') = 1,
  'the retry records nothing twice'
);

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
select pg_temp.assert_refused(
  $sql$ select accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
          'f0000000-0000-0000-0000-00000000000a', 'Accepting again',
          'e2000000-0000-0000-0000-000000000002') $sql$,
  'a risk that is already accepted cannot be accepted again'
);

select pg_temp.assert_refused(
  $sql$ select request_reassessment_entry('d0000000-0000-0000-0000-00000000000a',
          'f0000000-0000-0000-0000-00000000000a', null, null,
          'e1000000-0000-0000-0000-000000000003') $sql$,
  'an accepted risk cannot be sent for reassessment'
);

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, finding_id, requested_by, status)
        values ('d0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
                '33333333-3333-3333-3333-333333333333', 'queued') $sql$,
  'a direct reassessment request on an accepted risk is refused too'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'withdrawn'
        where id = (select ticket_id from risk_acceptance
                    where finding_id = 'f0000000-0000-0000-0000-00000000000a') $sql$,
  'a developer cannot end an acceptance by editing its ticket'
);

-- ---------------------------------------------------------------------------
-- Retraction
-- ---------------------------------------------------------------------------

select pg_temp.act_as('77777777-7777-7777-7777-777777777777');
select pg_temp.assert_refused(
  $sql$ select retract_risk_acceptance(
          ((select payload from first_acceptance) -> 'acceptance' ->> 'id')::uuid,
          'Not my application') $sql$,
  'a developer outside the application cannot retract its acceptance'
);

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
select pg_temp.assert_refused(
  $sql$ select retract_risk_acceptance(
          ((select payload from first_acceptance) -> 'acceptance' ->> 'id')::uuid, '') $sql$,
  'retracting an acceptance needs a reason'
);

create temporary table retraction on commit drop as
  select retract_risk_acceptance(
    ((select payload from first_acceptance) -> 'acceptance' ->> 'id')::uuid,
    'The server-side check was removed') as payload;

select pg_temp.act_as_owner();

select pg_temp.assert(
  (select end_reason = 'retracted' and ended_by = '33333333-3333-3333-3333-333333333333'
          and end_note = 'The server-side check was removed'
     from risk_acceptance
     where id = ((select payload from first_acceptance) -> 'acceptance' ->> 'id')::uuid),
  'another developer on the team can retract the acceptance'
);

select pg_temp.assert(
  (select t.status from risk_acceptance a join tickets t on t.id = a.ticket_id
     where a.id = ((select payload from first_acceptance) -> 'acceptance' ->> 'id')::uuid)
    = 'withdrawn',
  'the retracted acceptance ticket is withdrawn'
);

select pg_temp.assert(
  (select id from risk_conversation_entries
     where kind = 'risk_acceptance_retracted' and message = 'The server-side check was removed')
    = ((select payload from retraction) ->> 'entry_id')::uuid,
  'the retraction is recorded in the conversation and its entry is returned'
);

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
select pg_temp.assert(
  (retract_risk_acceptance(
     ((select payload from first_acceptance) -> 'acceptance' ->> 'id')::uuid,
     'The server-side check was removed') ->> 'entry_id')
    = ((select payload from retraction) ->> 'entry_id'),
  'a retried retraction resolves to the retraction already recorded'
);

select pg_temp.assert(
  (request_reassessment_entry('d0000000-0000-0000-0000-00000000000a',
     'f0000000-0000-0000-0000-00000000000a', null, null,
     'e1000000-0000-0000-0000-000000000004') -> 'run' ->> 'status') = 'queued',
  'after a retraction the risk can be sent for reassessment again'
);

-- ---------------------------------------------------------------------------
-- Later results: only Reduced Risk ends an acceptance
-- ---------------------------------------------------------------------------

create temporary table second_acceptance on commit drop as
  select accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
    'f0000000-0000-0000-0000-00000000000a', 'Accepted again for release 4',
    'e2000000-0000-0000-0000-000000000003') as payload;

select pg_temp.act_as_owner();

-- The sync worker records a status change as history, then updates the finding.
insert into finding_history (finding_id, previous_status, new_status, reason, sync_key)
values ('f0000000-0000-0000-0000-00000000000a', 'at_risk', 'inconclusive',
        'Automation result synced', 'example::run-2::history');
update findings set status = 'inconclusive', latest_test_run_id = 'example-run-2'
  where id = 'f0000000-0000-0000-0000-00000000000a';
set constraints trg_end_risk_acceptance_on_reduced_risk immediate;
set constraints trg_end_risk_acceptance_on_reduced_risk deferred;

select pg_temp.assert(
  (select ended_at is null from risk_acceptance
     where id = ((select payload from second_acceptance) -> 'acceptance' ->> 'id')::uuid),
  'an Inconclusive result leaves the acceptance in force'
);

insert into finding_history (finding_id, previous_status, new_status, reason, sync_key)
values ('f0000000-0000-0000-0000-00000000000a', 'inconclusive', 'reduced_risk',
        'Automation result synced', 'example::run-3::history');
update findings set status = 'reduced_risk', latest_test_run_id = 'example-run-3'
  where id = 'f0000000-0000-0000-0000-00000000000a';

select pg_temp.assert(
  (select ended_at is null from risk_acceptance
     where id = ((select payload from second_acceptance) -> 'acceptance' ->> 'id')::uuid),
  'the ending waits for the transaction to commit'
);

set constraints trg_end_risk_acceptance_on_reduced_risk immediate;
set constraints trg_end_risk_acceptance_on_reduced_risk deferred;

select pg_temp.assert(
  (select end_reason = 'resolved' and ended_at is not null from risk_acceptance
     where id = ((select payload from second_acceptance) -> 'acceptance' ->> 'id')::uuid),
  'a Reduced Risk result ends the acceptance'
);

select pg_temp.assert(
  (select t.status = 'closed' and t.closed_at is not null
     from risk_acceptance a join tickets t on t.id = a.ticket_id
     where a.id = ((select payload from second_acceptance) -> 'acceptance' ->> 'id')::uuid),
  'the resolved acceptance ticket is closed'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where kind = 'risk_acceptance_ended'
       and metadata ->> 'new_status' = 'reduced_risk') = 1,
  'the ending is recorded in the conversation once'
);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select pg_temp.assert_refused(
  $sql$ select retract_risk_acceptance(
          ((select payload from second_acceptance) -> 'acceptance' ->> 'id')::uuid,
          'Too late') $sql$,
  'an acceptance that ended on Reduced Risk cannot be retracted'
);

select pg_temp.assert_refused(
  $sql$ select accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
          'f0000000-0000-0000-0000-00000000000a', 'Nothing to accept',
          'e2000000-0000-0000-0000-000000000004') $sql$,
  'a Reduced Risk result has nothing to accept'
);

-- ---------------------------------------------------------------------------
-- A security reclassification to Reduced Risk ends an acceptance too
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();
update findings set status = 'at_risk' where id = 'f0000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
create temporary table third_acceptance on commit drop as
  select accept_risk_entry('d0000000-0000-0000-0000-00000000000a',
    'f0000000-0000-0000-0000-00000000000a', 'Accepted for release 5',
    'e2000000-0000-0000-0000-000000000005') as payload;

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select classify_risk_entry('f0000000-0000-0000-0000-00000000000a',
  'd0000000-0000-0000-0000-00000000000a', 'reduced_risk', 'Verified by manual review');
set constraints trg_end_risk_acceptance_on_reduced_risk immediate;
set constraints trg_end_risk_acceptance_on_reduced_risk deferred;

select pg_temp.act_as_owner();
select pg_temp.assert(
  (select end_reason from risk_acceptance
     where id = ((select payload from third_acceptance) -> 'acceptance' ->> 'id')::uuid)
    = 'resolved',
  'a security reclassification to Reduced Risk ends the acceptance'
);

select pg_temp.assert(
  (select seq from risk_conversation_entries
     where kind = 'risk_acceptance_ended'
       and metadata ->> 'acceptance_id' = (select payload from third_acceptance) -> 'acceptance' ->> 'id')
    > (select max(seq) from risk_conversation_entries where kind = 'classification_changed'),
  'the ending reads after the reclassification that caused it'
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  not has_function_privilege('anon', 'public.accept_risk_entry(uuid,uuid,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.retract_risk_acceptance(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.accept_risk_entry(uuid,uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.retract_risk_acceptance(uuid,text)', 'EXECUTE'),
  'only signed-in users can call the acceptance functions'
);

do $$ begin raise notice '0037 developer risk acceptance checks passed'; end $$;

rollback;
