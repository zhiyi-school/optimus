-- Retracting a risk acceptance reopens the remediation it withdrew (fix 0044).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0044 remediation reopened on retraction checks passed". Each assertion below
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

-- Accepts a finding's risk as a developer and returns the acceptance id.
create or replace function pg_temp.accept(developer uuid, conversation uuid, finding uuid,
                                          submission uuid) returns uuid
language plpgsql as $$
declare
  payload jsonb;
begin
  perform pg_temp.act_as(developer);
  payload := accept_risk_entry(conversation, finding, 'Compensated by server-side checks',
                               submission);
  perform pg_temp.act_as_owner();
  return (payload -> 'acceptance' ->> 'id')::uuid;
end;
$$;

-- Ends an acceptance as a retraction did before this fix, leaving its remediation withdrawn.
create or replace function pg_temp.retract_as_before_fix(acceptance uuid, developer uuid)
returns void
language plpgsql as $$
begin
  update risk_acceptance
  set ended_at = now(), ended_by = developer, end_reason = 'retracted',
      end_note = 'Retracted before the fix'
  where id = acceptance;
  update tickets set status = 'withdrawn'
  where id = (select ticket_id from risk_acceptance where id = acceptance);
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
   'authenticated', 'authenticated', 'developer-a2@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id in ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app', 'Example Application', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into assessments (id, external_id, application_id, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'run::example',
   'a0000000-0000-0000-0000-00000000000a', 'completed');

insert into findings (id, application_id, assessment_id, test_id, latest_test_run_id, title,
                      severity, status, platform)
select ('f0000000-0000-0000-0000-00000000000' || n)::uuid,
       'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a',
       'example-feature-01-risk-0' || n, 'example-run-1', 'Example finding ' || n,
       'high', 'at_risk', 'ios'
from generate_series(1, 5) as n;

insert into risk_conversations (id, application_id, origin_assessment_id, risk_id, finding_id)
select ('d0000000-0000-0000-0000-00000000000' || n)::uuid,
       'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a',
       'example-feature-01-risk-0' || n, ('f0000000-0000-0000-0000-00000000000' || n)::uuid
from generate_series(1, 5) as n;

insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id, selected_control_id)
select ('c0000000-0000-0000-0000-00000000000' || n)::uuid,
       ('f0000000-0000-0000-0000-00000000000' || n)::uuid,
       'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
       'Remediate: Example finding ' || n, '11111111-1111-1111-1111-111111111111',
       ('d0000000-0000-0000-0000-00000000000' || n)::uuid,
       'example-feature-01-risk-0' || n || '-control-01'
from generate_series(1, 5) as n;

insert into ticket_controls (id, ticket_id, control_id, status) values
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'example-feature-01-risk-01-control-01', 'in_progress');

-- ---------------------------------------------------------------------------
-- Retracting reopens the remediation the acceptance withdrew
-- ---------------------------------------------------------------------------

create temporary table acceptances (finding int primary key, id uuid) on commit drop;
grant select on acceptances to authenticated;
insert into acceptances values (1, pg_temp.accept('11111111-1111-1111-1111-111111111111',
  'd0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000001'));

select pg_temp.assert(
  (select status = 'withdrawn' and withdrawal_reason = 'Risk accepted'
     from tickets where id = 'c0000000-0000-0000-0000-000000000001'),
  'accepting still withdraws the open remediation with the reason Risk accepted'
);

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
select retract_risk_acceptance((select id from acceptances where finding = 1),
  'The server-side check was removed');
select pg_temp.act_as_owner();

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'open',
  'retracting the acceptance reopens the remediation as open'
);

select pg_temp.assert(
  (select selected_control_id = 'example-feature-01-risk-01-control-01'
          and closed_at is null and withdrawal_reason = 'Risk accepted'
     from tickets where id = 'c0000000-0000-0000-0000-000000000001')
  and exists (select 1 from ticket_controls where id = 'c1000000-0000-0000-0000-000000000001'),
  'the reopened remediation keeps its approach, progress and withdrawal record'
);

select pg_temp.assert(
  (select status from tickets t join risk_acceptance a on a.ticket_id = t.id
     where a.id = (select id from acceptances where finding = 1)) = 'withdrawn'
  and exists (select 1 from risk_conversation_entries
                where conversation_id = 'd0000000-0000-0000-0000-000000000001'
                  and kind = 'risk_acceptance_retracted'),
  'the acceptance itself still ends as retracted, with its conversation event'
);

select pg_temp.assert(
  (select count(*) from activity_log
     where entity_id = 'c0000000-0000-0000-0000-000000000001'
       and action = 'remediation_restored'
       and actor_id = '33333333-3333-3333-3333-333333333333') = 1,
  'the reopening is logged against the developer who retracted'
);

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
select retract_risk_acceptance((select id from acceptances where finding = 1),
  'The server-side check was removed');
select pg_temp.act_as_owner();

select pg_temp.assert(
  (select count(*) from activity_log where action = 'remediation_restored') = 1
  and (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'open',
  'a retried retraction reopens nothing twice'
);

-- ---------------------------------------------------------------------------
-- A developer's own withdrawal is left withdrawn
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
update tickets
set status = 'withdrawn', withdrawn_at = now(),
    withdrawn_by = '11111111-1111-1111-1111-111111111111',
    withdrawal_reason = 'The affected feature is being removed'
where id = 'c0000000-0000-0000-0000-000000000002';
select pg_temp.act_as_owner();

insert into acceptances values (2, pg_temp.accept('11111111-1111-1111-1111-111111111111',
  'd0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002',
  'e2000000-0000-0000-0000-000000000002'));

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select retract_risk_acceptance((select id from acceptances where finding = 2), 'Changed our mind');
select pg_temp.act_as_owner();

select pg_temp.assert(
  (select status = 'withdrawn' and withdrawal_reason = 'The affected feature is being removed'
     from tickets where id = 'c0000000-0000-0000-0000-000000000002'),
  'retracting leaves a remediation the developer withdrew themselves withdrawn'
);

-- ---------------------------------------------------------------------------
-- Clients cannot reopen a withdrawn remediation outside a retraction
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select pg_temp.assert_refused(
  $sql$select restore_remediation_paused_by_acceptance(
         (select id from acceptances where finding = 2))$sql$,
  'a developer cannot call the internal restore function'
);
select pg_temp.assert_refused(
  $sql$update tickets set status = 'open'
       where id = 'c0000000-0000-0000-0000-000000000002'$sql$,
  'a developer cannot move a withdrawn remediation to open directly'
);
select pg_temp.act_as_owner();

-- ---------------------------------------------------------------------------
-- The backfill reopens remediations retracted before the fix
-- ---------------------------------------------------------------------------

insert into acceptances
select n, pg_temp.accept('11111111-1111-1111-1111-111111111111',
  ('d0000000-0000-0000-0000-00000000000' || n)::uuid,
  ('f0000000-0000-0000-0000-00000000000' || n)::uuid,
  ('e2000000-0000-0000-0000-00000000000' || n)::uuid)
from generate_series(3, 5) as n;

select pg_temp.retract_as_before_fix(id, '33333333-3333-3333-3333-333333333333')
from acceptances where finding in (3, 4, 5);

-- Finding 4 has since been given a fresh remediation; finding 5 is now Reduced Risk.
insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     risk_conversation_id)
values ('c0000000-0000-0000-0000-000000000014', 'f0000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
        'Remediate again: Example finding 4', '11111111-1111-1111-1111-111111111111',
        'd0000000-0000-0000-0000-000000000004');
update findings set status = 'reduced_risk' where id = 'f0000000-0000-0000-0000-000000000005';

select pg_temp.assert(
  (select count(*) from tickets
     where id in ('c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000004',
                  'c0000000-0000-0000-0000-000000000005')
       and status = 'withdrawn') = 3,
  'before the backfill, remediations retracted before the fix are still withdrawn'
);

select restore_remediation_paused_by_acceptance(id) from acceptances where finding in (3, 4, 5);

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000003') = 'open',
  'the backfill reopens a remediation an earlier retraction left withdrawn'
);

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000004') = 'withdrawn',
  'the backfill leaves it withdrawn when a newer remediation is already active'
);

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000005') = 'withdrawn',
  'the backfill leaves it withdrawn when the risk is now Reduced Risk'
);

-- ---------------------------------------------------------------------------
-- Effective definitions
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  (select prosrc like '%perform restore_remediation_paused_by_acceptance(a.id)%'
     from pg_proc where proname = 'retract_risk_acceptance'),
  'the effective retract_risk_acceptance reopens the paused remediation'
);

select pg_temp.assert(
  not has_function_privilege('authenticated',
    'public.restore_remediation_paused_by_acceptance(uuid)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.restore_remediation_paused_by_acceptance(uuid)', 'EXECUTE'),
  'only the owner can run the restore function'
);

do $$ begin raise notice '0044 remediation reopened on retraction checks passed'; end $$;

rollback;
