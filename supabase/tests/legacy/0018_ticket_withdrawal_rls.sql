-- RLS and trigger checks for developer withdrawal (migration 0018).
--
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and run it. It creates
--   its own fixtures, asserts, and ends with `rollback` — nothing is left
--   behind, so it is safe to run against a live project. A failed assertion
--   raises and aborts; a clean run prints "0018 withdrawal checks passed".
--
--   It must run as the project owner (the SQL Editor default), because it
--   impersonates users by setting `request.jwt.claims` directly.
--
-- WHAT IT PROVES
--   A developer can withdraw only a remediation ticket their team owns and
--   only before security verification starts; a withdrawal must carry a reason
--   and name its author; `closed_at` is never touched; the finding stays
--   unresolved; withdrawal details cannot be edited afterwards; a withdrawn
--   ticket resumes only as in_progress; a developer can never reopen a ticket
--   security has finalised; and security keeps closure over everything.
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

-- One ticket per state under test, all on team A's application.
insert into tickets (id, finding_id, application_id, type, status, title, created_by) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
   'Remediate: Example finding A', '11111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'retest_requested',
   'Remediate: Example finding A (awaiting reassessment)',
   '11111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'open',
   'Remediate: Example finding A (spare)', '11111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'risk_acceptance', 'open',
   'Risk acceptance: Example finding A', '11111111-1111-1111-1111-111111111111');

update tickets set status = 'closed', closed_at = now()
  where id = 'c0000000-0000-0000-0000-000000000003';

insert into ticket_controls (id, ticket_id, control_id)
values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
        'example-feature-01-risk-01-control-01');

insert into ticket_control_steps (id, ticket_control_id, step_key, status)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
        'rotate-example-key', 'completed');

insert into assessments (id, external_id, application_id, status)
values ('b0000000-0000-0000-0000-00000000000a', 'example-run-1::example_app_a',
        'a0000000-0000-0000-0000-00000000000a', 'completed');

insert into risk_conversations
  (id, application_id, risk_id, origin_assessment_id, finding_id)
values ('c1000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
        'example-feature-01-risk-01', 'b0000000-0000-0000-0000-00000000000a',
        'f0000000-0000-0000-0000-00000000000a');

update tickets set risk_conversation_id = 'c1000000-0000-0000-0000-00000000000a';

insert into risk_conversation_entries (id, conversation_id, kind, author_id, message)
values ('11100000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000a',
        'message', '11111111-1111-1111-1111-111111111111', 'Example developer message.');

-- ---------------------------------------------------------------------------
-- Developer A: a withdrawal must be complete and honest
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'withdrawn'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'a withdrawal without a reason is refused'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'withdrawn', withdrawal_reason = '   ',
            withdrawn_at = now(), withdrawn_by = auth.uid()
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'a whitespace-only reason is refused'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'withdrawn', withdrawal_reason = 'Not proceeding.',
            withdrawn_at = now(), withdrawn_by = '22222222-2222-2222-2222-222222222222'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'a developer cannot record someone else as the one who withdrew'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'withdrawn', withdrawal_reason = 'Not proceeding.',
            withdrawn_by = auth.uid()
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'a withdrawal must record when it happened'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'withdrawn', withdrawal_reason = 'Not proceeding.',
            withdrawn_at = now(), withdrawn_by = auth.uid(), closed_at = now()
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'a withdrawal cannot also close the ticket'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'withdrawn', withdrawal_reason = 'Not proceeding.',
            withdrawn_at = now(), withdrawn_by = auth.uid()
        where id = 'c0000000-0000-0000-0000-000000000002' $sql$,
  'a developer cannot withdraw once a reassessment has been requested'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'withdrawn', withdrawal_reason = 'Not proceeding.',
            withdrawn_at = now(), withdrawn_by = auth.uid()
        where id = 'c0000000-0000-0000-0000-000000000004' $sql$,
  'a developer cannot withdraw a risk-acceptance ticket'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'withdrawn', withdrawal_reason = 'Too late.',
            withdrawn_at = now(), withdrawn_by = auth.uid()
        where id = 'c0000000-0000-0000-0000-000000000003' $sql$,
  'a developer cannot withdraw a ticket security has closed'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'in_progress', closed_at = null
        where id = 'c0000000-0000-0000-0000-000000000003' $sql$,
  'a developer cannot reopen a ticket security has closed'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'in_progress'
        where id = 'c0000000-0000-0000-0000-000000000003' $sql$,
  'a developer cannot reopen a closed ticket even leaving closed_at alone'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'closed'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'a developer cannot set a ticket to closed even leaving closed_at alone'
);

-- ---------------------------------------------------------------------------
-- Developer A: the withdrawal that is allowed
-- ---------------------------------------------------------------------------

update tickets
  set status = 'withdrawn',
      withdrawal_reason = 'The affected feature is being removed in the next release.',
      withdrawn_at = now(),
      withdrawn_by = auth.uid()
  where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'withdrawn',
  'a developer can withdraw a remediation ticket their team owns'
);

select pg_temp.assert(
  (select closed_at from tickets where id = 'c0000000-0000-0000-0000-000000000001') is null,
  'withdrawing never sets closed_at'
);

select pg_temp.assert(
  (select withdrawn_by from tickets where id = 'c0000000-0000-0000-0000-000000000001')
    = '11111111-1111-1111-1111-111111111111'
  and (select withdrawn_at from tickets where id = 'c0000000-0000-0000-0000-000000000001')
    is not null,
  'the withdrawal records who did it and when'
);

select pg_temp.assert(
  (select status from findings where id = 'f0000000-0000-0000-0000-00000000000a') = 'at_risk',
  'withdrawing leaves the finding unresolved'
);

select pg_temp.assert(
  (select count(*) from ticket_controls
     where ticket_id = 'c0000000-0000-0000-0000-000000000001') = 1
  and (select status from ticket_control_steps
         where id = 'e0000000-0000-0000-0000-000000000001') = 'completed'
  and (select count(*) from risk_conversation_entries
         where conversation_id = 'c1000000-0000-0000-0000-00000000000a') = 1,
  'control progress and the risk conversation survive the withdrawal'
);

select pg_temp.assert_refused(
  $sql$ update tickets set withdrawal_reason = 'A different story.'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'withdrawal details cannot be rewritten afterwards'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'fix_submitted'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'a withdrawn ticket cannot jump straight back to fix_submitted'
);

select pg_temp.assert_refused(
  $sql$ update tickets set status = 'closed', closed_at = now()
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'a developer cannot close a ticket they withdrew'
);

update tickets set status = 'in_progress' where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'in_progress',
  'a developer can resume a withdrawn ticket as in_progress'
);

select pg_temp.assert(
  (select withdrawal_reason from tickets where id = 'c0000000-0000-0000-0000-000000000001')
    = 'The affected feature is being removed in the next release.',
  'resuming keeps the withdrawal on the record as history'
);

-- ---------------------------------------------------------------------------
-- Developer B: cannot withdraw another team's ticket
-- ---------------------------------------------------------------------------

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select pg_temp.assert(
  (select count(*) from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 0,
  'a developer on another team cannot see team A''s ticket'
);

update tickets
  set status = 'withdrawn', withdrawal_reason = 'Not mine.',
      withdrawn_at = now(), withdrawn_by = auth.uid()
  where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.act_as_owner();
select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'in_progress',
  'a developer on another team cannot withdraw team A''s ticket'
);

-- ---------------------------------------------------------------------------
-- Security: still sees withdrawn work and still owns closure
-- ---------------------------------------------------------------------------

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

update tickets
  set status = 'withdrawn', withdrawal_reason = 'Recorded on the developer''s behalf.',
      withdrawn_at = now(), withdrawn_by = '11111111-1111-1111-1111-111111111111'
  where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select count(*) from tickets where status = 'withdrawn') = 1,
  'security can see a withdrawn ticket'
);

update tickets set status = 'closed', closed_at = now()
  where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'closed'
  and (select closed_at from tickets where id = 'c0000000-0000-0000-0000-000000000001') is not null,
  'security can close a withdrawn ticket'
);

update findings set status = 'reduced_risk' where id = 'f0000000-0000-0000-0000-00000000000a';
select pg_temp.assert(
  (select status from findings where id = 'f0000000-0000-0000-0000-00000000000a') = 'reduced_risk',
  'security still owns the finding''s status'
);

select pg_temp.act_as_owner();

do $$ begin raise notice '0018 withdrawal checks passed'; end $$;

rollback;
