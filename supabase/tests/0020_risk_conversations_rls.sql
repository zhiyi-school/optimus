-- RLS, trigger and migration checks for risk conversations (migration 0020).
--
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and run it. It creates
--   its own fixtures, asserts, and ends with `rollback` — nothing is left
--   behind, so it is safe to run against a live project. A failed assertion
--   raises and aborts; a clean run prints "0020 risk conversation checks passed".
--
--   It must run as the project owner (the SQL Editor default), because it
--   impersonates users by setting `request.jwt.claims` directly.
--
-- WHAT IT PROVES
--   Entries belong to exactly one conversation; security and developers on the
--   owning team can read and post; only security can record a classification
--   change or a retest lifecycle event; a developer cannot request a
--   reassessment without an eligible remediation ticket; the CIO stays
--   read-only; a developer on another team sees nothing; the feed is
--   append-only; a ticket keeps the conversation it was opened against; and the
--   legacy message tables are exposed to nobody.
--
--   The conversation's identity, the merge that produced it and the historical
--   message migration are covered by 0021_application_risk_conversations_rls.
--
-- All identifiers below are placeholders and belong to no real user or app.

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
  ('a0000000-0000-0000-0000-00000000000b', 'example_app_b', 'Example Application B', 'ios',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into assessments (id, external_id, application_id, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'example-run-1::example_app_a',
   'a0000000-0000-0000-0000-00000000000a', 'completed'),
  ('b0000000-0000-0000-0000-00000000000b', 'example-run-1::example_app_b',
   'a0000000-0000-0000-0000-00000000000b', 'completed');

insert into findings (id, application_id, assessment_id, test_id, title, severity, status, platform)
values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01',
   'Example finding A', 'high', 'at_risk', 'ios'),
  ('f0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b', 'example-feature-01-risk-01',
   'Example finding B', 'high', 'at_risk', 'ios');

insert into risk_conversations
  (id, application_id, risk_id, origin_assessment_id, finding_id)
values
  ('c1000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'example-feature-01-risk-01', 'b0000000-0000-0000-0000-00000000000a',
   'f0000000-0000-0000-0000-00000000000a'),
  ('c1000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000a',
   'example-feature-02-risk-01', 'b0000000-0000-0000-0000-00000000000a', null),
  ('c1000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000b',
   'example-feature-01-risk-01', 'b0000000-0000-0000-0000-00000000000b',
   'f0000000-0000-0000-0000-00000000000b');

insert into tickets
  (id, finding_id, application_id, type, status, title, created_by, risk_conversation_id)
values
  ('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
   'Remediate: Example finding A', '11111111-1111-1111-1111-111111111111',
   'c1000000-0000-0000-0000-00000000000a'),
  ('d0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'fix_submitted',
   'Remediate: Example finding A (fix submitted)', '11111111-1111-1111-1111-111111111111',
   'c1000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------------------
-- Developer A: can read and talk, cannot classify or run tests
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (select count(*) from risk_conversations) = 2,
  'a developer sees the conversations for their own team''s application only'
);

select pg_temp.assert(
  (select count(*) from risk_conversations
     where id = 'c1000000-0000-0000-0000-00000000000b') = 0,
  'a developer cannot read a conversation on another team''s application'
);

insert into risk_conversation_entries (conversation_id, kind, author_id, message)
values ('c1000000-0000-0000-0000-00000000000a', 'message',
        '11111111-1111-1111-1111-111111111111', 'Example developer question.');

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'c1000000-0000-0000-0000-00000000000a' and kind = 'message') = 1,
  'a developer on the owning team can post a message'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_entries (conversation_id, kind, author_id, message)
        values ('c1000000-0000-0000-0000-00000000000b', 'message',
                '11111111-1111-1111-1111-111111111111', 'Not my application.') $sql$,
  'a developer cannot post into another team''s conversation'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_entries (conversation_id, kind, author_id, message, metadata)
        values ('c1000000-0000-0000-0000-00000000000a', 'classification_changed',
                '11111111-1111-1111-1111-111111111111', 'Looks fine to me.',
                '{"new_status": "reduced_risk"}'::jsonb) $sql$,
  'a developer cannot record a classification change'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_entries (conversation_id, kind, author_id)
        values ('c1000000-0000-0000-0000-00000000000a', 'retest_started',
                '11111111-1111-1111-1111-111111111111') $sql$,
  'a developer cannot record that a retest started'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_entries (conversation_id, kind, author_id)
        values ('c1000000-0000-0000-0000-00000000000a', 'retest_completed',
                '11111111-1111-1111-1111-111111111111') $sql$,
  'a developer cannot record a retest result'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_entries (conversation_id, kind, author_id, message)
        values ('c1000000-0000-0000-0000-00000000000a', 'message',
                '44444444-4444-4444-4444-444444444444', 'Posted as somebody else.') $sql$,
  'a developer cannot post under another person''s name'
);

update findings set status = 'reduced_risk' where id = 'f0000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from findings where id = 'f0000000-0000-0000-0000-00000000000a') = 'at_risk',
  'a developer cannot change the risk classification itself'
);

-- ---------------------------------------------------------------------------
-- Developer A: a reassessment request still needs an eligible ticket
-- ---------------------------------------------------------------------------

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, finding_id, requested_by, status)
        values ('c1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'a developer cannot start a retest run straight from the conversation'
);

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('c1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001',
                'f0000000-0000-0000-0000-00000000000a',
                '11111111-1111-1111-1111-111111111111', 'queued') $sql$,
  'a developer cannot request a reassessment before submitting a fix'
);

insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
values ('c1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002',
        'f0000000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs
     where conversation_id = 'c1000000-0000-0000-0000-00000000000a') = 1,
  'a developer can request a reassessment from a ticket with a submitted fix'
);

insert into risk_conversation_entries
  (conversation_id, kind, author_id, source_ticket_id)
values ('c1000000-0000-0000-0000-00000000000a', 'retest_requested',
        '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002');

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'c1000000-0000-0000-0000-00000000000a'
       and kind = 'retest_requested') = 1,
  'the reassessment request shows up in the risk conversation'
);

-- ---------------------------------------------------------------------------
-- Append-only
-- ---------------------------------------------------------------------------

-- No update or delete policy exists, so these statements match no row at all
-- rather than raising: the proof is that nothing changed.
update risk_conversation_entries set message = 'Rewritten.'
  where conversation_id = 'c1000000-0000-0000-0000-00000000000a';

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'c1000000-0000-0000-0000-00000000000a'
       and message = 'Rewritten.') = 0
  and (select message from risk_conversation_entries
         where conversation_id = 'c1000000-0000-0000-0000-00000000000a' and kind = 'message')
      = 'Example developer question.',
  'an entry cannot be edited'
);

delete from risk_conversation_entries
  where conversation_id = 'c1000000-0000-0000-0000-00000000000a';

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'c1000000-0000-0000-0000-00000000000a') = 2,
  'an entry cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- Developer A: the ticket keeps the conversation it was opened against
-- ---------------------------------------------------------------------------

select pg_temp.assert_refused(
  $sql$ update tickets set risk_conversation_id = 'c1000000-0000-0000-0000-00000000000c'
        where id = 'd0000000-0000-0000-0000-000000000001' $sql$,
  'a developer cannot repoint a ticket at another risk conversation'
);

-- ---------------------------------------------------------------------------
-- Developer B: another team is fully walled off
-- ---------------------------------------------------------------------------

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select pg_temp.assert(
  (select count(*) from risk_conversation_entries) = 0,
  'a developer on another team reads none of team A''s entries'
);

select pg_temp.assert(
  (select count(*) from risk_conversations
     where id = 'c1000000-0000-0000-0000-00000000000a') = 0,
  'a developer on another team cannot read team A''s conversation'
);

-- ---------------------------------------------------------------------------
-- CIO: read-only
-- ---------------------------------------------------------------------------

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'c1000000-0000-0000-0000-00000000000a') = 2,
  'the CIO can read a risk conversation'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_entries (conversation_id, kind, author_id, message)
        values ('c1000000-0000-0000-0000-00000000000a', 'message',
                '33333333-3333-3333-3333-333333333333', 'An executive comment.') $sql$,
  'the CIO cannot post a message'
);

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('c1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002',
                'f0000000-0000-0000-0000-00000000000a',
                '33333333-3333-3333-3333-333333333333', 'queued') $sql$,
  'the CIO cannot request a retest even from an eligible ticket'
);

-- ---------------------------------------------------------------------------
-- Security: owns classification and the retest lifecycle
-- ---------------------------------------------------------------------------

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert(
  (select count(*) from risk_conversations) = 3,
  'security reads every conversation'
);

insert into risk_conversation_entries (conversation_id, kind, author_id, message, metadata)
values ('c1000000-0000-0000-0000-00000000000a', 'classification_changed',
        '44444444-4444-4444-4444-444444444444', 'Verified on the current build.',
        jsonb_build_object('previous_status', 'at_risk', 'new_status', 'reduced_risk'));

insert into risk_conversation_entries (conversation_id, kind, author_id)
values ('c1000000-0000-0000-0000-00000000000a', 'retest_started',
        '44444444-4444-4444-4444-444444444444');

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'c1000000-0000-0000-0000-00000000000a'
       and kind in ('classification_changed', 'retest_started')) = 2,
  'security can record a classification change and a retest start'
);

update findings set status = 'reduced_risk' where id = 'f0000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from findings where id = 'f0000000-0000-0000-0000-00000000000a')
    = 'reduced_risk',
  'security still owns the finding status the classification records'
);

insert into finding_history (finding_id, previous_status, new_status, changed_by, reason)
values ('f0000000-0000-0000-0000-00000000000a', 'at_risk', 'reduced_risk',
        '44444444-4444-4444-4444-444444444444', 'Verified on the current build.');

select pg_temp.assert(
  (select count(*) from finding_history
     where finding_id = 'f0000000-0000-0000-0000-00000000000a') = 1,
  'the classification change is still written to the finding history'
);

insert into retest_runs (conversation_id, finding_id, requested_by, status)
values ('c1000000-0000-0000-0000-00000000000c', 'f0000000-0000-0000-0000-00000000000a',
        '44444444-4444-4444-4444-444444444444', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs where ticket_id is null) = 1,
  'security can run a retest a conversation owns with no ticket behind it'
);

update risk_conversation_entries set message = 'Rewritten by security.'
  where conversation_id = 'c1000000-0000-0000-0000-00000000000a';

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where message = 'Rewritten by security.') = 0,
  'not even security can rewrite a past workflow event'
);

-- ---------------------------------------------------------------------------
-- Entries stay in their own conversation
-- ---------------------------------------------------------------------------

insert into risk_conversation_entries (conversation_id, kind, author_id, message)
values ('c1000000-0000-0000-0000-00000000000c', 'message',
        '44444444-4444-4444-4444-444444444444', 'A different risk entirely.');

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'c1000000-0000-0000-0000-00000000000c') = 1
  and (select count(*) from risk_conversation_entries
         where conversation_id = 'c1000000-0000-0000-0000-00000000000a') = 4,
  'two risks on one application do not share entries'
);

select pg_temp.act_as_owner();

-- ---------------------------------------------------------------------------
-- The legacy tables are archive-only: no policy grants access to anyone
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  (select count(*) from pg_policies
     where schemaname = 'public'
       and tablename in ('assessment_messages', 'ticket_messages', 'ticket_attachments')) = 0,
  'no policy exposes a legacy conversation table to the dashboard'
);

insert into assessment_messages (assessment_id, author_id, message)
values ('b0000000-0000-0000-0000-00000000000a', '44444444-4444-4444-4444-444444444444',
        'A legacy assessment-wide message.');

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert(
  (select count(*) from assessment_messages) = 0,
  'not even security can read an archived conversation through the dashboard'
);

select pg_temp.assert_refused(
  $sql$ insert into assessment_messages (assessment_id, author_id, message)
        values ('b0000000-0000-0000-0000-00000000000a',
                '44444444-4444-4444-4444-444444444444', 'A new one.') $sql$,
  'no new assessment-wide message can be created'
);

select pg_temp.assert_refused(
  $sql$ insert into ticket_messages (ticket_id, author_id, message)
        values ('d0000000-0000-0000-0000-000000000001',
                '44444444-4444-4444-4444-444444444444', 'A new one.') $sql$,
  'no new ticket message can be created'
);

select pg_temp.act_as_owner();

do $$ begin raise notice '0020 risk conversation checks passed'; end $$;

rollback;
