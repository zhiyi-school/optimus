-- RLS and trigger checks for the selected remediation approach (migration 0022).
--
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and run it. It creates
--   its own fixtures, asserts, and ends with `rollback` — nothing is left
--   behind, so it is safe to run against a live project. A failed assertion
--   raises and aborts; a clean run prints "0022 selection checks passed".
--
--   It must run as the project owner (the SQL Editor default), because it
--   impersonates users by setting `request.jwt.claims` directly.
--
-- WHAT IT PROVES
--   A developer can set the approach only on a remediation ticket their team
--   owns and only while the ticket is still theirs; the approach cannot change
--   once security verification has started or after security finalises the
--   ticket; a blank id is refused; security may always correct it; another
--   team's developer can neither read nor write it; and `ticket_controls` no
--   longer carries a `required` column for anything to key work off.
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
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'security@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team A', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Developer Team B', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';
update profiles set team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', roles = array['developer']
  where id = '22222222-2222-2222-2222-222222222222';
update profiles set team_id = null, roles = array['security']
  where id = '44444444-4444-4444-4444-444444444444';

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app_a', 'Example Application A', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into findings (id, application_id, test_id, title, severity, status, platform) values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'example-feature-01-risk-01', 'Example finding A', 'high', 'at_risk', 'ios');

insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     selected_control_id) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
   'Remediate: Example finding A', '11111111-1111-1111-1111-111111111111',
   'example-feature-01-risk-01-control-01'),
  ('c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'retest_requested',
   'Remediate: Example finding A (awaiting reassessment)',
   '11111111-1111-1111-1111-111111111111', 'example-feature-01-risk-01-control-01'),
  ('c0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'closed',
   'Remediate: Example finding A (finalised)', '11111111-1111-1111-1111-111111111111',
   'example-feature-01-risk-01-control-01'),
  ('c0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'app_provisioning', 'open',
   'Provision Example Application A', '11111111-1111-1111-1111-111111111111', null);

-- ---------------------------------------------------------------------------
-- The column stores an identifier only, and nothing keys work off `required`
-- ---------------------------------------------------------------------------

select pg_temp.act_as_owner();

select pg_temp.assert(
  exists (
    select 1 from information_schema.columns
    where table_name = 'tickets' and column_name = 'selected_control_id'
      and data_type = 'text' and is_nullable = 'YES'
  ),
  'tickets.selected_control_id is a nullable text identifier'
);

select pg_temp.assert(
  not exists (
    select 1 from information_schema.columns
    where table_name = 'tickets' and column_name = 'selected_control_id'
      and column_name in (
        select column_name from information_schema.columns where table_name = 'tickets'
      )
      and exists (
        select 1 from information_schema.table_constraints tc
        join information_schema.key_column_usage k using (constraint_name)
        where tc.constraint_type = 'FOREIGN KEY' and k.column_name = 'selected_control_id'
      )
  ),
  'selected_control_id is not a foreign key to copied playbook content'
);

select pg_temp.assert(
  not exists (
    select 1 from information_schema.columns
    where table_name = 'ticket_controls' and column_name = 'required'
  ),
  'ticket_controls.required is gone, so nothing can key work off it'
);

select pg_temp.assert(
  not exists (
    select 1 from information_schema.columns
    where table_name in ('tickets', 'ticket_controls', 'ticket_control_steps')
      and column_name in ('title', 'summary', 'step_title', 'step_index', 'step_count',
                          'position', 'playbook_revision', 'content_hash')
      and not (table_name = 'tickets' and column_name = 'title')
  ),
  'no playbook title, summary, ordering or revision is stored alongside progress'
);

select pg_temp.assert_refused(
  $$update tickets set selected_control_id = '   '
      where id = 'c0000000-0000-0000-0000-000000000001'$$,
  'a blank approach id is refused at the database boundary'
);

-- ---------------------------------------------------------------------------
-- The developer who owns the work
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

update tickets set selected_control_id = 'example-feature-01-risk-01-control-02'
  where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select selected_control_id from tickets where id = 'c0000000-0000-0000-0000-000000000001')
    = 'example-feature-01-risk-01-control-02',
  'a developer can change the approach while the ticket is still theirs'
);

select pg_temp.assert_refused(
  $$update tickets set selected_control_id = 'example-feature-01-risk-01-control-02'
      where id = 'c0000000-0000-0000-0000-000000000002'$$,
  'the approach cannot change once security verification has started'
);

select pg_temp.assert_refused(
  $$update tickets set selected_control_id = 'example-feature-01-risk-01-control-02'
      where id = 'c0000000-0000-0000-0000-000000000003'$$,
  'the approach cannot change after security has finalised the ticket'
);

select pg_temp.assert_refused(
  $$update tickets set selected_control_id = 'example-feature-01-risk-01-control-02'
      where id = 'c0000000-0000-0000-0000-000000000004'$$,
  'only a remediation ticket has a remediation approach'
);

select pg_temp.assert_refused(
  $$update tickets set selected_control_id = ''
      where id = 'c0000000-0000-0000-0000-000000000001'$$,
  'a developer cannot store an empty approach id'
);

-- ---------------------------------------------------------------------------
-- A developer on another team
-- ---------------------------------------------------------------------------

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select pg_temp.assert(
  not exists (select 1 from tickets where id = 'c0000000-0000-0000-0000-000000000001'),
  'another team''s developer cannot even see the ticket, let alone its approach'
);

update tickets set selected_control_id = 'example-feature-01-risk-01-control-03'
  where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.act_as_owner();
select pg_temp.assert(
  (select selected_control_id from tickets where id = 'c0000000-0000-0000-0000-000000000001')
    = 'example-feature-01-risk-01-control-02',
  'the other team''s write changed nothing'
);

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert(
  (select selected_control_id from tickets where id = 'c0000000-0000-0000-0000-000000000002')
    = 'example-feature-01-risk-01-control-01',
  'security can inspect the approach a developer chose'
);

update tickets set selected_control_id = 'example-feature-01-risk-01-control-09'
  where id = 'c0000000-0000-0000-0000-000000000002';

select pg_temp.assert(
  (select selected_control_id from tickets where id = 'c0000000-0000-0000-0000-000000000002')
    = 'example-feature-01-risk-01-control-09',
  'security can correct the approach even mid-verification'
);

select pg_temp.act_as_owner();

do $$ begin raise notice '0022 selection checks passed'; end $$;

rollback;
