-- RLS checks for the developer remediation workflow (migration 0017).
--
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and run it. It creates
--   its own fixtures, asserts, and ends with `rollback` — nothing is left
--   behind, so it is safe to run against a live project. A failed assertion
--   raises and aborts; a clean run prints "0017 RLS checks passed".
--
--   It must run as the project owner (the SQL Editor default), because it
--   impersonates users by setting `request.jwt.claims` directly.
--
-- WHAT IT PROVES
--   Team scoping still holds, a developer with no team sees nothing, and every
--   security-owned action (closing a ticket, changing a finding, running a
--   retest, approving risk acceptance, reassigning a ticket) is refused for a
--   developer even when they go straight at the table.
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
   'authenticated', 'authenticated', 'developer-none@example.test'),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'security@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team A', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Developer Team B', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id = '11111111-1111-1111-1111-111111111111';
update profiles set team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', roles = array['developer']
  where id = '22222222-2222-2222-2222-222222222222';
update profiles set team_id = null, roles = array['developer']
  where id = '33333333-3333-3333-3333-333333333333';
update profiles set team_id = null, roles = array['security']
  where id = '44444444-4444-4444-4444-444444444444';

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app_a', 'Example Application A', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('b0000000-0000-0000-0000-00000000000b', 'example_app_b', 'Example Application B', 'ios',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into findings (id, application_id, test_id, title, severity, status, platform) values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'example-feature-01-risk-01', 'Example finding A', 'high', 'at_risk', 'ios'),
  ('f0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b',
   'example-feature-01-risk-01', 'Example finding B', 'high', 'at_risk', 'ios');

insert into tickets (id, finding_id, application_id, type, status, title, created_by) values
  ('c0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'open', 'Remediate: Example finding A',
   '11111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b', 'remediation', 'open', 'Remediate: Example finding B',
   '22222222-2222-2222-2222-222222222222');

insert into ticket_controls (id, ticket_id, control_id, required) values
  ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a',
   'example-feature-01-risk-01-control-01', true),
  ('d0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b',
   'example-feature-01-risk-01-control-01', true);

insert into ticket_control_steps (id, ticket_control_id, step_key) values
  ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a', 'rotate-example-key'),
  ('e0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000b', 'rotate-example-key');

-- ---------------------------------------------------------------------------
-- Developer A: sees only their own team's rows
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (select count(*) from applications) = 1
    and (select external_id from applications) = 'example_app_a',
  'a developer sees only the application assigned to their team'
);

select pg_temp.assert(
  (select count(*) from tickets) = 1
    and (select id from tickets) = 'c0000000-0000-0000-0000-00000000000a',
  'a developer sees only tickets for their own application'
);

select pg_temp.assert(
  (select count(*) from ticket_controls) = 1
    and (select id from ticket_controls) = 'd0000000-0000-0000-0000-00000000000a',
  'control progress follows the ticket, so another team''s controls are invisible'
);

select pg_temp.assert(
  (select count(*) from ticket_control_steps) = 1,
  'another team''s control steps are invisible'
);

-- ---------------------------------------------------------------------------
-- Developer A: permitted progress writes
-- ---------------------------------------------------------------------------

update ticket_control_steps
  set status = 'completed', completed_at = now(), completed_by = auth.uid()
  where id = 'e0000000-0000-0000-0000-00000000000a';

select pg_temp.assert(
  (select status from ticket_control_steps where id = 'e0000000-0000-0000-0000-00000000000a')
    = 'completed',
  'a developer can complete a step on a ticket their team owns'
);

update ticket_controls set status = 'completed' where id = 'd0000000-0000-0000-0000-00000000000a';

select pg_temp.assert(
  (select status from ticket_controls where id = 'd0000000-0000-0000-0000-00000000000a')
    = 'completed',
  'a developer can update a control on a ticket their team owns'
);

update tickets set status = 'fix_submitted' where id = 'c0000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-00000000000a') = 'fix_submitted',
  'a developer can submit a fix'
);

update tickets set status = 'retest_requested' where id = 'c0000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-00000000000a')
    = 'retest_requested',
  'a developer can request a reassessment'
);

-- ---------------------------------------------------------------------------
-- Developer A: everything security owns is refused
-- ---------------------------------------------------------------------------

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'closed', closed_at = now()
        where id = 'c0000000-0000-0000-0000-00000000000a' $sql$,
  'a developer cannot close a ticket'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'accepted'
        where id = 'c0000000-0000-0000-0000-00000000000a' $sql$,
  'a developer cannot mark a ticket accepted'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'retest_in_progress'
        where id = 'c0000000-0000-0000-0000-00000000000a' $sql$,
  'a developer cannot start a security verification'
);

select pg_temp.assert_refused(
  $sql$ update tickets set assigned_team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        where id = 'c0000000-0000-0000-0000-00000000000a' $sql$,
  'a developer cannot reassign a ticket to another team'
);

select pg_temp.assert_refused(
  $sql$ update tickets set application_id = 'b0000000-0000-0000-0000-00000000000b'
        where id = 'c0000000-0000-0000-0000-00000000000a' $sql$,
  'a developer cannot move a ticket onto another application'
);

update findings set status = 'reduced_risk' where id = 'f0000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from findings where id = 'f0000000-0000-0000-0000-00000000000a') = 'at_risk',
  'a developer cannot change a finding''s status'
);

insert into retest_runs (id, ticket_id, finding_id, requested_by, status)
values ('90000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a',
        'f0000000-0000-0000-0000-00000000000a', auth.uid(), 'queued');

update retest_runs set status = 'completed', result = 'Reduced Risk'
  where id = '90000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from retest_runs where id = '90000000-0000-0000-0000-00000000000a') = 'queued',
  'a developer can request a retest but cannot record its result'
);

insert into risk_acceptance (id, ticket_id, finding_id, requested_by, reason, decision)
values ('80000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a',
        'f0000000-0000-0000-0000-00000000000a', auth.uid(), 'Example reason', 'pending');

update risk_acceptance set decision = 'accepted'
  where id = '80000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select decision from risk_acceptance where id = '80000000-0000-0000-0000-00000000000a')
    = 'pending',
  'a developer cannot approve their own risk acceptance'
);

delete from ticket_control_steps where id = 'e0000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select count(*) from ticket_control_steps where id = 'e0000000-0000-0000-0000-00000000000a') = 1,
  'progress rows are an audit trail and cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- Developer B: cannot reach team A's rows at all
-- ---------------------------------------------------------------------------

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select pg_temp.assert(
  (select count(*) from tickets where id = 'c0000000-0000-0000-0000-00000000000a') = 0,
  'a developer on another team cannot see team A''s ticket'
);

update ticket_control_steps set status = 'completed'
  where id = 'e0000000-0000-0000-0000-00000000000a';
select pg_temp.act_as_owner();
select pg_temp.assert(
  (select status from ticket_control_steps where id = 'e0000000-0000-0000-0000-00000000000a')
    = 'completed',
  'a developer on another team cannot alter team A''s step (it keeps team A''s own value)'
);

-- ---------------------------------------------------------------------------
-- Developer with no team: sees nothing, never everything
-- ---------------------------------------------------------------------------

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');

select pg_temp.assert(
  (select count(*) from applications) = 0,
  'a developer with no team sees no applications at all'
);
select pg_temp.assert(
  (select count(*) from findings) = 0,
  'a developer with no team sees no findings'
);
select pg_temp.assert(
  (select count(*) from tickets) = 0,
  'a developer with no team sees no tickets'
);
select pg_temp.assert(
  (select count(*) from ticket_controls) = 0,
  'a developer with no team sees no control progress'
);

-- ---------------------------------------------------------------------------
-- Security: keeps verification and closure
-- ---------------------------------------------------------------------------

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select pg_temp.assert(
  (select count(*) from applications) = 2,
  'security sees every application regardless of team'
);

select pg_temp.assert(
  (select count(*) from ticket_controls) = 2,
  'security can read developer control progress'
);

update retest_runs set status = 'completed', result = 'Reduced Risk'
  where id = '90000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from retest_runs where id = '90000000-0000-0000-0000-00000000000a') = 'completed',
  'security can record a retest result'
);

update findings set status = 'reduced_risk' where id = 'f0000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from findings where id = 'f0000000-0000-0000-0000-00000000000a') = 'reduced_risk',
  'security can update a finding'
);

update tickets set status = 'closed', closed_at = now()
  where id = 'c0000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-00000000000a') = 'closed',
  'security can close a ticket'
);

update risk_acceptance set decision = 'accepted'
  where id = '80000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select decision from risk_acceptance where id = '80000000-0000-0000-0000-00000000000a')
    = 'accepted',
  'security can approve a risk acceptance'
);

select pg_temp.act_as_owner();

do $$ begin raise notice '0017 RLS checks passed'; end $$;

rollback;
