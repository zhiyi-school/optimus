-- Synced test runs in conversation activity (fix 0040).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0040 test runs in conversation activity checks passed". Each assertion below
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
   'authenticated', 'authenticated', 'developer-a@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team A', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Developer Team B', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app_a', 'Example Application A', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a0000000-0000-0000-0000-00000000000b', 'example_app_b', 'Example Application B', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a0000000-0000-0000-0000-00000000000c', 'example_app_c', 'Example Application C', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a0000000-0000-0000-0000-00000000000d', 'example_app_d', 'Example Application D', 'ios',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into risk_conversations (id, application_id, risk_id) values
  ('d0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'example-risk-01');

insert into risk_conversation_entries (conversation_id, kind, author_id, message, created_at) values
  ('d0000000-0000-0000-0000-00000000000a', 'message', '11111111-1111-1111-1111-111111111111',
   'A message', '2026-03-01T09:00:00Z');

-- The trigger stamps updated_at on update, so the sync times are set after insert.
insert into findings (id, application_id, test_id, latest_test_run_id, title, status, platform)
values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'example-risk-01', '2026-03-04_09-00-00', 'Example finding A', 'at_risk', 'ios'),
  ('f0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000b',
   'example-risk-01', '2026-03-06_09-00-00', 'Example finding B', 'at_risk', 'ios'),
  ('f0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000c',
   'example-risk-01', null, 'Example finding C', 'inconclusive', 'ios'),
  ('f0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000d',
   'example-risk-01', '2026-03-08_09-00-00', 'Example finding D', 'at_risk', 'ios');

alter table findings disable trigger trg_findings_updated_at;
update findings set updated_at = '2026-03-04T09:05:00Z' where id = 'f0000000-0000-0000-0000-00000000000a';
update findings set updated_at = '2026-03-06T09:05:00Z' where id = 'f0000000-0000-0000-0000-00000000000b';
update findings set updated_at = '2026-03-09T09:05:00Z' where id = 'f0000000-0000-0000-0000-00000000000c';
update findings set updated_at = '2026-03-08T09:05:00Z' where id = 'f0000000-0000-0000-0000-00000000000d';
alter table findings enable trigger trg_findings_updated_at;

-- ---------------------------------------------------------------------------
-- Synced test runs count as conversation activity
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (select last_entry_at from risk_conversation_activity()
     where application_id = 'a0000000-0000-0000-0000-00000000000a') = '2026-03-04T09:05:00Z',
  'a test run synced after the last message is the latest activity'
);

select pg_temp.assert(
  (select last_entry_at from risk_conversation_activity()
     where application_id = 'a0000000-0000-0000-0000-00000000000b') = '2026-03-06T09:05:00Z',
  'a test run counts even when the risk has no stored conversation'
);

select pg_temp.assert(
  not exists (select 1 from risk_conversation_activity()
              where application_id = 'a0000000-0000-0000-0000-00000000000c'),
  'a finding that no test run has produced is not activity'
);

select pg_temp.assert(
  not exists (select 1 from risk_conversation_activity()
              where application_id = 'a0000000-0000-0000-0000-00000000000d'),
  'a developer sees no test-run activity for another team''s application'
);

select pg_temp.act_as_owner();

select pg_temp.assert(
  not has_function_privilege('anon', 'public.risk_conversation_activity()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.risk_conversation_activity()', 'EXECUTE'),
  'the recreated function keeps its grants'
);

do $$ begin raise notice '0040 test runs in conversation activity checks passed'; end $$;

rollback;
