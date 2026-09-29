-- Identity, migration, RLS and workflow checks for the application-risk
-- conversation (migration 0021).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0021 application risk conversation checks passed". Each assertion below
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
-- Fixtures: one application assessed twice, and another team's application
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

insert into assessments (id, external_id, application_id, status, created_at) values
  ('b0000000-0000-0000-0000-000000000001', 'example-run-1::example_app_a',
   'a0000000-0000-0000-0000-00000000000a', 'completed', '2026-01-01T00:00:00Z'),
  ('b0000000-0000-0000-0000-000000000002', 'example-run-2::example_app_a',
   'a0000000-0000-0000-0000-00000000000a', 'completed', '2026-02-01T00:00:00Z'),
  ('b0000000-0000-0000-0000-00000000000b', 'example-run-1::example_app_b',
   'a0000000-0000-0000-0000-00000000000b', 'completed', '2026-01-01T00:00:00Z');

-- The finding's own assessment reference names the newest run that produced it.
insert into findings (id, application_id, assessment_id, test_id, title, severity, status, platform)
values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-000000000002', 'example-feature-01-risk-01',
   'Example finding A', 'high', 'at_risk', 'ios'),
  ('f0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b', 'example-feature-01-risk-01',
   'Example finding B', 'high', 'at_risk', 'ios');

-- ---------------------------------------------------------------------------
-- The merge that turned two per-assessment threads into one
-- ---------------------------------------------------------------------------

-- Duplicates cannot exist under the new key, so the constraint is lifted
-- exactly as the migration lifts it: merge first, then re-apply.
alter table risk_conversations drop constraint risk_conversations_unique_per_application_risk;

insert into risk_conversations
  (id, application_id, risk_id, origin_assessment_id, finding_id, created_at)
values
  ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
   'example-feature-01-risk-01', 'b0000000-0000-0000-0000-000000000001', null,
   '2026-01-01T01:00:00Z'),
  ('c1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a',
   'example-feature-01-risk-01', 'b0000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-00000000000a', '2026-02-01T01:00:00Z'),
  ('c1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a',
   'example-feature-02-risk-01', 'b0000000-0000-0000-0000-000000000002', null,
   '2026-02-01T01:00:00Z'),
  ('c1000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000b',
   'example-feature-01-risk-01', 'b0000000-0000-0000-0000-00000000000b',
   'f0000000-0000-0000-0000-00000000000b', '2026-01-01T01:00:00Z');

insert into tickets
  (id, finding_id, application_id, type, status, title, created_by,
   risk_conversation_id, origin_assessment_id)
values
  ('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'fix_submitted',
   'Remediate: Example finding A', '11111111-1111-1111-1111-111111111111',
   'c1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002');

insert into risk_conversation_entries
  (id, conversation_id, kind, author_id, message, created_at)
values
  ('e0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   'message', '11111111-1111-1111-1111-111111111111', 'First round question.',
   '2026-01-05T00:00:00Z'),
  ('e0000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001',
   'classification_changed', '44444444-4444-4444-4444-444444444444', 'Still at risk.',
   '2026-01-06T00:00:00Z'),
  ('e0000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002',
   'message', '44444444-4444-4444-4444-444444444444', 'Second round answer.',
   '2026-02-05T00:00:00Z');

insert into risk_conversation_attachments
  (id, entry_id, uploaded_by, storage_path, file_name, mime_type)
values
  ('e2000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'conversation-c1000000-0000-0000-0000-000000000001/example-evidence.png',
   'example-evidence.png', 'image/png');

insert into retest_runs
  (id, conversation_id, ticket_id, finding_id, requested_by, status, created_at)
values
  ('90000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   '11111111-1111-1111-1111-111111111111', 'completed', '2026-01-07T00:00:00Z');

select merge_duplicate_risk_conversations();

alter table risk_conversations
  add constraint risk_conversations_unique_per_application_risk
  unique (application_id, risk_id);

select pg_temp.assert(
  (select count(*) from risk_conversations
     where application_id = 'a0000000-0000-0000-0000-00000000000a'
       and risk_id = 'example-feature-01-risk-01') = 1,
  'two per-assessment threads for one application risk become one'
);

select pg_temp.assert(
  (select count(*) from risk_conversations
     where id = 'c1000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from risk_conversations
         where id = 'c1000000-0000-0000-0000-000000000002') = 0,
  'the oldest thread is the one that survives'
);

select pg_temp.assert(
  (select array_agg(message order by created_at, seq)
     from risk_conversation_entries
    where conversation_id = 'c1000000-0000-0000-0000-000000000001')
  = array['First round question.', 'Still at risk.', 'Second round answer.'],
  'every entry moves across, still in the order it happened'
);

select pg_temp.assert(
  (select kind from risk_conversation_entries
     where id = 'e0000000-0000-0000-0000-000000000002') = 'classification_changed'
  and (select author_id from risk_conversation_entries
         where id = 'e0000000-0000-0000-0000-000000000003')
      = '44444444-4444-4444-4444-444444444444',
  'a merged entry keeps its kind and its author'
);

select pg_temp.assert(
  (select e.conversation_id from risk_conversation_attachments a
     join risk_conversation_entries e on e.id = a.entry_id
    where a.id = 'e2000000-0000-0000-0000-000000000001')
    = 'c1000000-0000-0000-0000-000000000001'
  and (select storage_path from risk_conversation_attachments
         where id = 'e2000000-0000-0000-0000-000000000001')
      = 'conversation-c1000000-0000-0000-0000-000000000001/example-evidence.png',
  'an attachment follows its entry with its stored object path intact'
);

select pg_temp.assert(
  (select risk_conversation_id from tickets
     where id = 'd0000000-0000-0000-0000-000000000001')
    = 'c1000000-0000-0000-0000-000000000001',
  'a ticket linked to a merged-away thread is repointed at the survivor'
);

select pg_temp.assert(
  (select conversation_id from retest_runs
     where id = '90000000-0000-0000-0000-000000000001')
    = 'c1000000-0000-0000-0000-000000000001',
  'a retest record is repointed rather than orphaned'
);

select pg_temp.assert(
  (select finding_id from risk_conversations
     where id = 'c1000000-0000-0000-0000-000000000001')
    = 'f0000000-0000-0000-0000-00000000000a',
  'the survivor inherits the finding the merged-away thread knew about'
);

select pg_temp.assert(
  (select origin_assessment_id from tickets
     where id = 'd0000000-0000-0000-0000-000000000001')
    = 'b0000000-0000-0000-0000-000000000002',
  'a ticket still names the assessment it was raised against, not the older one'
);

select pg_temp.assert(
  (select count(*) from risk_conversations
     where application_id = 'a0000000-0000-0000-0000-00000000000a') = 2,
  'a different risk on the same application is left as its own conversation'
);

-- ---------------------------------------------------------------------------
-- Identity: one per application risk, and it never moves
-- ---------------------------------------------------------------------------

select pg_temp.assert_refused(
  $sql$ insert into risk_conversations (application_id, risk_id)
        values ('a0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01') $sql$,
  'a second conversation for the same application risk is refused'
);

select pg_temp.assert(
  (select count(*) from risk_conversations where risk_id = 'example-feature-01-risk-01') = 2,
  'the same risk on another application is a different conversation'
);

select pg_temp.assert_refused(
  $sql$ update risk_conversations set application_id = 'a0000000-0000-0000-0000-00000000000b'
        where id = 'c1000000-0000-0000-0000-000000000001' $sql$,
  'a conversation cannot be moved to another application'
);

select pg_temp.assert_refused(
  $sql$ update risk_conversations set risk_id = 'example-feature-09-risk-09'
        where id = 'c1000000-0000-0000-0000-000000000001' $sql$,
  'a conversation cannot be repointed at another risk'
);

select pg_temp.assert_refused(
  $sql$ update risk_conversations
        set origin_assessment_id = 'b0000000-0000-0000-0000-000000000002'
        where id = 'c1000000-0000-0000-0000-000000000001' $sql$,
  'a conversation keeps the assessment it was opened under'
);

-- A later run of the same application must reuse the thread, not open one.
insert into risk_conversations (application_id, risk_id, origin_assessment_id)
values ('a0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01',
        'b0000000-0000-0000-0000-000000000002')
on conflict (application_id, risk_id) do nothing;

select pg_temp.assert(
  (select count(*) from risk_conversations
     where application_id = 'a0000000-0000-0000-0000-00000000000a'
       and risk_id = 'example-feature-01-risk-01') = 1,
  'a new assessment of the same application opens no second conversation'
);

select pg_temp.assert(
  (select count(*) from risk_conversations
     where application_id is null) = 0,
  'every conversation names the application it belongs to'
);

-- ---------------------------------------------------------------------------
-- Access follows the application, not the assessment
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (select count(*) from risk_conversations) = 2,
  'a developer reads every conversation on their own team''s application'
);

select pg_temp.assert(
  (select count(*) from risk_conversations
     where id = 'c1000000-0000-0000-0000-00000000000b') = 0,
  'a developer cannot read a conversation on another team''s application'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries) = 3,
  'a developer reads the merged thread in full'
);

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select pg_temp.assert(
  (select count(*) from risk_conversations
     where application_id = 'a0000000-0000-0000-0000-00000000000a') = 0
  and (select count(*) from risk_conversation_entries) = 0,
  'another organisation''s developer reaches neither the conversation nor its entries'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_entries (conversation_id, kind, author_id, message)
        values ('c1000000-0000-0000-0000-000000000001', 'message',
                '22222222-2222-2222-2222-222222222222', 'Not my application.') $sql$,
  'another organisation''s developer cannot post into it either'
);

select pg_temp.act_as_owner();

-- Deleting an assessment must not take the application's conversation with it.
delete from assessments where id = 'b0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select count(*) from risk_conversations
     where id = 'c1000000-0000-0000-0000-000000000001') = 1
  and (select origin_assessment_id from risk_conversations
         where id = 'c1000000-0000-0000-0000-000000000001') is null,
  'a conversation outlives the assessment it was opened under'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'c1000000-0000-0000-0000-000000000001') = 3,
  'its entries outlive that assessment too'
);

-- ---------------------------------------------------------------------------
-- Classification: one operation, security only
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ select classify_risk('f0000000-0000-0000-0000-00000000000a',
                             'c1000000-0000-0000-0000-000000000001',
                             'reduced_risk', 'Looks fine to me.') $sql$,
  'a developer cannot change the risk classification'
);

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');

select pg_temp.assert_refused(
  $sql$ select classify_risk('f0000000-0000-0000-0000-00000000000a',
                             'c1000000-0000-0000-0000-000000000001',
                             'reduced_risk', 'Approved.') $sql$,
  'the CIO cannot change the risk classification'
);

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert_refused(
  $sql$ select classify_risk('f0000000-0000-0000-0000-00000000000a',
                             'c1000000-0000-0000-0000-000000000001',
                             'reduced_risk', '   ') $sql$,
  'a classification change still needs a reason'
);

select pg_temp.assert_refused(
  $sql$ select classify_risk('f0000000-0000-0000-0000-00000000000b',
                             'c1000000-0000-0000-0000-000000000001',
                             'reduced_risk', 'Wrong application.') $sql$,
  'a finding from another application cannot be classified through this conversation'
);

select pg_temp.assert(
  (select status from findings where id = 'f0000000-0000-0000-0000-00000000000b') = 'at_risk'
  and (select count(*) from finding_history
         where finding_id = 'f0000000-0000-0000-0000-00000000000b') = 0
  and (select count(*) from risk_conversation_entries
         where message = 'Wrong application.') = 0,
  'a refused classification writes nothing at all'
);

select classify_risk('f0000000-0000-0000-0000-00000000000a',
                     'c1000000-0000-0000-0000-000000000001',
                     'reduced_risk', 'Verified on the current build.');

select pg_temp.assert(
  (select status from findings where id = 'f0000000-0000-0000-0000-00000000000a')
    = 'reduced_risk',
  'security changes the classification through the conversation'
);

select pg_temp.assert(
  (select count(*) from finding_history
     where finding_id = 'f0000000-0000-0000-0000-00000000000a'
       and previous_status = 'at_risk'
       and new_status = 'reduced_risk'
       and changed_by = '44444444-4444-4444-4444-444444444444'
       and reason = 'Verified on the current build.') = 1,
  'the same call records the finding history, with its reason and its author'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where conversation_id = 'c1000000-0000-0000-0000-000000000001'
       and kind = 'classification_changed'
       and message = 'Verified on the current build.'
       and metadata = jsonb_build_object(
             'previous_status', 'at_risk', 'new_status', 'reduced_risk')) = 1,
  'and posts the matching event in the conversation, from the same statement'
);

select pg_temp.assert(
  (select count(*) from activity_log
     where entity_type = 'finding'
       and entity_id = 'f0000000-0000-0000-0000-00000000000a'
       and action = 'finding_status_changed') = 1,
  'the activity log still records the change'
);

select pg_temp.assert_refused(
  $sql$ select classify_risk('f0000000-0000-0000-0000-00000000000a',
                             'c1000000-0000-0000-0000-000000000001',
                             'not_a_status', 'Nonsense.') $sql$,
  'an unknown classification is refused'
);

-- ---------------------------------------------------------------------------
-- One reassessment in flight per risk
-- ---------------------------------------------------------------------------

insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
values ('c1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-00000000000a',
        '44444444-4444-4444-4444-444444444444', 'queued');

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('c1000000-0000-0000-0000-000000000001',
                'd0000000-0000-0000-0000-000000000001',
                'f0000000-0000-0000-0000-00000000000a',
                '44444444-4444-4444-4444-444444444444', 'queued') $sql$,
  'a second reassessment cannot be queued while one is in flight'
);

update retest_runs set status = 'completed', completed_at = now()
  where conversation_id = 'c1000000-0000-0000-0000-000000000001' and status = 'queued';

insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
values ('c1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-00000000000a',
        '44444444-4444-4444-4444-444444444444', 'queued');

select pg_temp.assert(
  (select count(*) from retest_runs
     where conversation_id = 'c1000000-0000-0000-0000-000000000001') = 3,
  'a new reassessment is allowed once the last one has finished, and the old records stay'
);

select pg_temp.assert_refused(
  $sql$ insert into retest_runs (conversation_id, ticket_id, finding_id, requested_by, status)
        values ('c1000000-0000-0000-0000-000000000003',
                'd0000000-0000-0000-0000-000000000001',
                'f0000000-0000-0000-0000-00000000000a',
                '44444444-4444-4444-4444-444444444444', 'queued') $sql$,
  'a reassessment cannot be requested from a ticket raised against another risk'
);

select pg_temp.act_as_owner();

-- ---------------------------------------------------------------------------
-- The legacy tickets 0020 could not place
-- ---------------------------------------------------------------------------

-- Application C is assessed twice, so 0020 left its ticket unlinked: there was
-- no way to say which assessment's conversation it belonged to. Under the
-- application key that question does not arise.
insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000c', 'example_app_c', 'Example Application C', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into assessments (id, external_id, application_id, status) values
  ('b0000000-0000-0000-0000-0000000000c1', 'example-run-1::example_app_c',
   'a0000000-0000-0000-0000-00000000000c', 'completed'),
  ('b0000000-0000-0000-0000-0000000000c2', 'example-run-2::example_app_c',
   'a0000000-0000-0000-0000-00000000000c', 'completed');

insert into findings (id, application_id, assessment_id, test_id, title, severity, status, platform)
values
  ('f0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000c',
   'b0000000-0000-0000-0000-0000000000c2', 'example-feature-03-risk-01',
   'Example finding C', 'high', 'at_risk', 'ios'),
  ('f0000000-0000-0000-0000-0000000000cc', 'a0000000-0000-0000-0000-00000000000c',
   'b0000000-0000-0000-0000-0000000000c2', null,
   'Example finding with no risk', 'low', 'at_risk', 'ios');

insert into tickets (id, finding_id, application_id, type, status, title, created_by) values
  ('d0000000-0000-0000-0000-00000000000c', 'f0000000-0000-0000-0000-00000000000c',
   'a0000000-0000-0000-0000-00000000000c', 'remediation', 'in_progress',
   'Remediate: Example finding C', '11111111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-0000000000cc', 'f0000000-0000-0000-0000-0000000000cc',
   'a0000000-0000-0000-0000-00000000000c', 'remediation', 'in_progress',
   'Remediate: a finding that names no risk', '11111111-1111-1111-1111-111111111111');

insert into ticket_messages (id, ticket_id, author_id, message, created_at) values
  ('e1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000c',
   '11111111-1111-1111-1111-111111111111', 'First legacy ticket message.',
   '2026-01-01T00:00:00Z'),
  ('e1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000c',
   '44444444-4444-4444-4444-444444444444', 'Second legacy ticket message.',
   '2026-01-02T00:00:00Z'),
  ('e1000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-0000000000cc',
   '11111111-1111-1111-1111-111111111111', 'A message on a ticket with no risk.',
   '2026-01-03T00:00:00Z');

insert into ticket_attachments
  (id, ticket_id, message_id, uploaded_by, storage_path, file_name, mime_type)
values
  ('e2000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-00000000000c',
   'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000c/example-evidence.png', 'example-evidence.png',
   'image/png'),
  ('e2000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-00000000000c',
   null, '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-00000000000c/example-unlinked.png', 'example-unlinked.png',
   'image/png');

insert into assessment_messages (assessment_id, author_id, message)
values ('b0000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444',
        'A legacy assessment-wide message.');

select place_unlinked_ticket_conversations();

select pg_temp.assert(
  (select risk_conversation_id from tickets
     where id = 'd0000000-0000-0000-0000-00000000000c')
  = (select id from risk_conversations
       where application_id = 'a0000000-0000-0000-0000-00000000000c'
         and risk_id = 'example-feature-03-risk-01'),
  'a ticket on an application with several assessments is now placed exactly'
);

select pg_temp.assert(
  (select risk_conversation_id from tickets
     where id = 'd0000000-0000-0000-0000-0000000000cc') is null,
  'a ticket whose finding names no risk is still left unlinked, not guessed at'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where sync_key like 'legacy-ticket-message::%') = 2,
  'the archived messages of a placed ticket migrate with it'
);

select pg_temp.assert(
  (select array_agg(e.message order by e.created_at, e.seq)
     from risk_conversation_entries e
    where e.sync_key like 'legacy-ticket-message::%')
  = array['First legacy ticket message.', 'Second legacy ticket message.'],
  'they arrive in the order they were written'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries e
     join ticket_messages m on m.migrated_entry_id = e.id
    where e.source_ticket_id = m.ticket_id and e.author_id = m.author_id) = 2,
  'each keeps its author and the ticket it came from'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where message = 'A message on a ticket with no risk.') = 0,
  'a message on a ticket that could not be placed is left where it is'
);

select pg_temp.assert(
  (select r.storage_path from risk_conversation_attachments r
     join ticket_attachments a on a.migrated_attachment_id = r.id
    where a.id = 'e2000000-0000-0000-0000-00000000000c')
  = 'd0000000-0000-0000-0000-00000000000c/example-evidence.png',
  'a message attachment migrates with its stored object path intact'
);

select pg_temp.assert(
  (select migrated_attachment_id from ticket_attachments
     where id = 'e2000000-0000-0000-0000-00000000000d') is null,
  'an attachment that was never linked to a message is left unmigrated'
);

select place_unlinked_ticket_conversations();
select place_unlinked_ticket_conversations();

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where sync_key like 'legacy-ticket-message::%') = 2
  and (select count(*) from risk_conversation_attachments
         where sync_key like 'legacy-ticket-attachment::%') = 1
  and (select count(*) from risk_conversations
         where application_id = 'a0000000-0000-0000-0000-00000000000c') = 1,
  'rerunning the placement adds nothing'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_entries
     where message = 'A legacy assessment-wide message.') = 0
  and (select count(*) from assessment_messages) = 1,
  'an assessment-wide message names no risk, so it is still never assigned to one'
);

-- ---------------------------------------------------------------------------
-- A ticket keeps what it was opened against
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ update tickets set risk_conversation_id = 'c1000000-0000-0000-0000-000000000003'
        where id = 'd0000000-0000-0000-0000-000000000001' $sql$,
  'a developer cannot repoint a ticket at another risk conversation'
);

select pg_temp.assert_refused(
  $sql$ update tickets set origin_assessment_id = 'b0000000-0000-0000-0000-0000000000c1'
        where id = 'd0000000-0000-0000-0000-000000000001' $sql$,
  'a developer cannot rewrite the assessment a ticket was raised against'
);

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert_refused(
  $sql$ update tickets set origin_assessment_id = 'b0000000-0000-0000-0000-0000000000c1'
        where id = 'd0000000-0000-0000-0000-000000000001' $sql$,
  'not even security can rewrite it: it is the record of where the work began'
);

select pg_temp.assert(
  (select origin_assessment_id from tickets
     where id = 'd0000000-0000-0000-0000-000000000001')
    = 'b0000000-0000-0000-0000-000000000002',
  'the ticket still names the assessment it was raised against'
);

select pg_temp.act_as_owner();

do $$ begin raise notice '0021 application risk conversation checks passed'; end $$;

rollback;
