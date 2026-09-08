-- Who may read a conversation attachment's metadata and its stored object,
-- and what migration 0027 records about where the bytes live.
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0027 attachment download checks passed". Each assertion below names what it
-- proves. All identifiers are placeholders.

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
-- Fixtures: one application with a developer team, and an unrelated developer
-- on a different team who has nothing to do with it.
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

-- One ordinary message from the developer, and one workflow event from security.
insert into risk_conversation_entries (id, conversation_id, kind, author_id, message) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
   'message', '11111111-1111-1111-1111-111111111111', 'Here is the evidence.'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000a',
   'classification_changed', '44444444-4444-4444-4444-444444444444', 'Verified.');

-- ---------------------------------------------------------------------------
-- The developer uploads a file; the storage policy is asked the same question
-- the dashboard asks when it signs a download link.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

insert into risk_conversation_attachments
  (id, entry_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
values
  ('11110000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'conversation-d0000000-0000-0000-0000-00000000000a/1700000000000-evidence.png',
   'quarterly evidence.png', 'image/png', 2048);

select pg_temp.assert(
  (select storage_provider from risk_conversation_attachments
     where id = '11110000-0000-0000-0000-00000000000a') = 'supabase',
  'an upload that names no provider is recorded as a Supabase object'
);

select pg_temp.assert(
  (select size_bytes from risk_conversation_attachments
     where id = '11110000-0000-0000-0000-00000000000a') = 2048,
  'the recorded size survives the insert, so the reader is told how large the file is'
);

select pg_temp.assert(
  (select count(*) from risk_conversation_attachments
     where id = '11110000-0000-0000-0000-00000000000a') = 1,
  'the uploader can read back the file they attached'
);

select pg_temp.assert(
  can_access_attachment_object(
    'conversation-d0000000-0000-0000-0000-00000000000a/1700000000000-evidence.png') is true,
  'the uploader may read the stored object itself'
);

-- ---------------------------------------------------------------------------
-- A different authorised participant, who did not upload it
-- ---------------------------------------------------------------------------

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert(
  (select uploaded_by from risk_conversation_attachments
     where id = '11110000-0000-0000-0000-00000000000a')
    = '11111111-1111-1111-1111-111111111111',
  'security reads the metadata of a file someone else uploaded'
);

select pg_temp.assert(
  can_access_attachment_object(
    'conversation-d0000000-0000-0000-0000-00000000000a/1700000000000-evidence.png') is true,
  'access follows the conversation, not uploaded_by, so security may download it too'
);

-- A file attached to a workflow event behaves exactly like one on a message.
insert into risk_conversation_attachments
  (id, entry_id, uploaded_by, storage_path, file_name, mime_type, storage_provider)
values
  ('11110000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000002',
   '44444444-4444-4444-4444-444444444444',
   'conversation-d0000000-0000-0000-0000-00000000000a/1700000000001-decision.pdf',
   'decision (final).pdf', 'application/pdf', 'supabase');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (select count(*) from risk_conversation_attachments
     where entry_id = 'e0000000-0000-0000-0000-000000000002') = 1,
  'the developer can read a file recorded against a classification decision'
);

-- ---------------------------------------------------------------------------
-- Someone with no claim on the application
-- ---------------------------------------------------------------------------

select pg_temp.act_as('77777777-7777-7777-7777-777777777777');

select pg_temp.assert(
  (select count(*) from risk_conversation_attachments) = 0,
  'an unrelated developer sees no attachment metadata at all'
);

select pg_temp.assert(
  can_access_attachment_object(
    'conversation-d0000000-0000-0000-0000-00000000000a/1700000000000-evidence.png') is false,
  'an unrelated developer is refused the stored object'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_attachments
          (entry_id, uploaded_by, storage_path, file_name)
        values ('e0000000-0000-0000-0000-000000000001',
                '77777777-7777-7777-7777-777777777777',
                'conversation-d0000000-0000-0000-0000-00000000000a/1700000000002-intruder.png',
                'intruder.png') $sql$,
  'an unrelated developer cannot attach a file to a conversation they cannot see'
);

-- ---------------------------------------------------------------------------
-- A storage key is always relative to its provider
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_attachments
          (entry_id, uploaded_by, storage_path, file_name)
        values ('e0000000-0000-0000-0000-000000000001',
                '11111111-1111-1111-1111-111111111111',
                '/Users/example/secrets.txt', 'secrets.txt') $sql$,
  'an absolute host path cannot be recorded as a storage key'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_attachments
          (entry_id, uploaded_by, storage_path, file_name)
        values ('e0000000-0000-0000-0000-000000000001',
                '11111111-1111-1111-1111-111111111111',
                'conversation-d0000000-0000-0000-0000-00000000000a/../../etc/passwd',
                'passwd') $sql$,
  'a storage key cannot walk out of its own folder'
);

select pg_temp.assert_refused(
  $sql$ insert into risk_conversation_attachments
          (entry_id, uploaded_by, storage_path, file_name, storage_provider)
        values ('e0000000-0000-0000-0000-000000000001',
                '11111111-1111-1111-1111-111111111111',
                'conversation-d0000000-0000-0000-0000-00000000000a/1700000000003-x.png',
                'x.png', 'somewhere-else') $sql$,
  'only the two known providers may be recorded'
);

do $$ begin raise notice '0027 attachment download checks passed'; end $$;

rollback;
