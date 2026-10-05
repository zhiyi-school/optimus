-- Conversation activity per application for the Last Updated column (fix 0039).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0039 conversation activity checks passed". Each assertion below names what
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
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'security@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team A', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Developer Team B', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';
update profiles set team_id = null, roles = array['security']
  where id = '44444444-4444-4444-4444-444444444444';

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app_a', 'Example Application A', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a0000000-0000-0000-0000-00000000000b', 'example_app_b', 'Example Application B', 'ios',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('a0000000-0000-0000-0000-00000000000c', 'example_app_c', 'Example Application C', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into risk_conversations (id, application_id, risk_id) values
  ('d0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'example-risk-01'),
  ('d0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a', 'example-risk-02'),
  ('d0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000b', 'example-risk-01'),
  -- Opened by a page view, with nothing recorded in it.
  ('d0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000c', 'example-risk-01');

insert into risk_conversation_entries (conversation_id, kind, author_id, message, created_at) values
  ('d0000000-0000-0000-0000-00000000000a', 'message', '11111111-1111-1111-1111-111111111111',
   'Older message', '2026-03-01T09:00:00Z'),
  ('d0000000-0000-0000-0000-00000000000b', 'message', '11111111-1111-1111-1111-111111111111',
   'Newest message on A', '2026-03-05T09:00:00Z'),
  ('d0000000-0000-0000-0000-00000000000c', 'retest_completed', null,
   null, '2026-03-07T09:00:00Z');

-- ---------------------------------------------------------------------------
-- The newest entry per application, within the caller's access
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (select at from risk_conversation_activity() as activity(application_id, at)
     where application_id = 'a0000000-0000-0000-0000-00000000000a') = '2026-03-05T09:00:00Z',
  'an application reports its newest entry across all of its risk conversations'
);

select pg_temp.assert(
  not exists (select 1 from risk_conversation_activity() as activity(application_id, at)
              where application_id = 'a0000000-0000-0000-0000-00000000000b'),
  'a developer sees no activity for another team''s application'
);

select pg_temp.assert(
  not exists (select 1 from risk_conversation_activity() as activity(application_id, at)
              where application_id = 'a0000000-0000-0000-0000-00000000000c'),
  'a conversation with no entries is not activity'
);

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert(
  (select at from risk_conversation_activity() as activity(application_id, at)
     where application_id = 'a0000000-0000-0000-0000-00000000000b') = '2026-03-07T09:00:00Z',
  'security sees every application, including automation-written events'
);

select pg_temp.act_as_owner();

select pg_temp.assert(
  not has_function_privilege('anon', 'public.risk_conversation_activity()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.risk_conversation_activity()', 'EXECUTE'),
  'only signed-in users can read conversation activity'
);

do $$ begin raise notice '0039 conversation activity checks passed'; end $$;

rollback;
