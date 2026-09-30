-- Developer-side ticket guards restored by fix 0035.
--
-- Run through `npm run test:database`, which applies it to a disposable
-- database only. It creates its own fixtures and ends with `rollback`. A failed
-- assertion raises and aborts; a clean run prints "0035 ticket guard checks
-- passed". All identifiers are placeholders.

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

-- Passes only when the statement is refused with the named trigger message.
create or replace function pg_temp.assert_refused_by(statement text, expected text, description text)
returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then
      raise exception 'FAILED: % — refused for the wrong reason: %', description, sqlerrm;
    end if;
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
   'authenticated', 'authenticated', 'developer@example.test'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'security@example.test'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'teammate@example.test');

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team', 'developer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Other Developer Team', 'developer');

update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles = array['developer']
  where id in ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');
update profiles set roles = array['security']
  where id = '22222222-2222-2222-2222-222222222222';

-- Both applications belong to the developer's team, so RLS alone would admit a move between them.
insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app', 'Example Application', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a0000000-0000-0000-0000-00000000000b', 'second_app', 'Second Application', 'ios',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into assessments (id, external_id, application_id, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'run::example',
   'a0000000-0000-0000-0000-00000000000a', 'completed');

insert into findings (id, application_id, assessment_id, test_id, title, severity, status, platform)
values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01',
   'Example finding', 'high', 'at_risk', 'ios'),
  ('f0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-02',
   'Another finding', 'medium', 'at_risk', 'ios');

insert into risk_conversations (id, application_id, origin_assessment_id, risk_id, finding_id)
values
  ('d0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-00000000000a', 'example-feature-01-risk-01',
   'f0000000-0000-0000-0000-00000000000a');

insert into tickets (id, finding_id, application_id, type, status, title, created_by,
                     assigned_team_id, risk_conversation_id) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress',
   'Remediate: Example finding', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd0000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------------------
-- A developer cannot change who or what a ticket belongs to
-- ---------------------------------------------------------------------------

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.assert_refused_by(
  $sql$ update tickets set type = 'risk_acceptance'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'ownership fields', 'a developer cannot change a ticket''s type'
);

select pg_temp.assert_refused_by(
  $sql$ update tickets set finding_id = 'f0000000-0000-0000-0000-00000000000b'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'ownership fields', 'a developer cannot move a ticket to another finding'
);

select pg_temp.assert_refused_by(
  $sql$ update tickets set application_id = 'a0000000-0000-0000-0000-00000000000b'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'ownership fields', 'a developer cannot move a ticket to another application their team owns'
);

select pg_temp.assert_refused_by(
  $sql$ update tickets set created_by = '33333333-3333-3333-3333-333333333333'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'ownership fields', 'a developer cannot rewrite who opened a ticket'
);

select pg_temp.assert_refused_by(
  $sql$ update tickets set assigned_user_id = '33333333-3333-3333-3333-333333333333'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'ownership fields', 'a developer cannot reassign a ticket to another person'
);

select pg_temp.assert_refused_by(
  $sql$ update tickets set assigned_team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'ownership fields', 'a developer cannot reassign a ticket to another team'
);

select pg_temp.assert_refused_by(
  $sql$ update tickets set closed_at = now()
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'only the security team can close', 'a developer cannot stamp closed_at on an open ticket'
);

select pg_temp.assert_refused_by(
  $sql$ update tickets set withdrawal_reason = 'Pre-filled'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'recorded once', 'a developer cannot write withdrawal details without withdrawing'
);

-- ---------------------------------------------------------------------------
-- Ordinary developer work still goes through
-- ---------------------------------------------------------------------------

update tickets set selected_control_id = 'example-control-01'
where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select selected_control_id from tickets where id = 'c0000000-0000-0000-0000-000000000001')
    = 'example-control-01',
  'a developer can still choose a remediation approach'
);

update tickets set status = 'open', closed_at = null
where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'open',
  'a developer can still change status the way updateStatus does, with an unchanged null closed_at'
);

-- ---------------------------------------------------------------------------
-- Withdrawal details are written once
-- ---------------------------------------------------------------------------

select pg_temp.assert_refused_by(
  $sql$ update tickets
        set status = 'withdrawn', withdrawn_by = '11111111-1111-1111-1111-111111111111',
            withdrawal_reason = 'No longer needed'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'records when it was made', 'a withdrawal must record withdrawn_at'
);

update tickets
set status = 'withdrawn', withdrawn_at = now(),
    withdrawn_by = '11111111-1111-1111-1111-111111111111', withdrawal_reason = 'No longer needed'
where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'withdrawn',
  'a developer can still withdraw a remediation'
);

select pg_temp.assert_refused_by(
  $sql$ update tickets set withdrawal_reason = 'A different story'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'recorded once', 'the withdrawal reason cannot be edited afterwards'
);

select pg_temp.assert_refused_by(
  $sql$ update tickets set withdrawn_by = '33333333-3333-3333-3333-333333333333'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'recorded once', 'the withdrawing developer cannot be rewritten'
);

select pg_temp.assert_refused_by(
  $sql$ update tickets set withdrawn_at = now() - interval '1 day'
        where id = 'c0000000-0000-0000-0000-000000000001' $sql$,
  'recorded once', 'the withdrawal time cannot be backdated'
);

update tickets set status = 'in_progress' where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'in_progress'
    and (select withdrawal_reason from tickets where id = 'c0000000-0000-0000-0000-000000000001')
      = 'No longer needed',
  'a withdrawn remediation still resumes, keeping its withdrawal record'
);

-- ---------------------------------------------------------------------------
-- Internal reassessment transitions are unaffected
-- ---------------------------------------------------------------------------

select pg_temp.assert(
  (select (request_reassessment_entry(
     'd0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
     'c0000000-0000-0000-0000-000000000001', null,
     '99999999-9999-9999-9999-999999999999') -> 'run' ->> 'status')) = 'queued',
  'a developer can still request a reassessment against the ticket'
);

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'retest_requested',
  'the reconciler still moves the ticket to retest_requested'
);

select pg_temp.assert(
  (select status from withdraw_reassessment(
     (select id from retest_runs where submission_id = '99999999-9999-9999-9999-999999999999'),
     'Asked too early')) = 'cancelled',
  'a developer can still withdraw that request'
);

select pg_temp.assert(
  (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') = 'in_progress',
  'withdrawing the request still restores the ticket'
);

-- ---------------------------------------------------------------------------
-- Security keeps control of the same fields
-- ---------------------------------------------------------------------------

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

update tickets
set finding_id = 'f0000000-0000-0000-0000-00000000000b',
    assigned_user_id = '33333333-3333-3333-3333-333333333333'
where id = 'c0000000-0000-0000-0000-000000000001';

update tickets set status = 'closed', closed_at = now()
where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.assert(
  (select finding_id = 'f0000000-0000-0000-0000-00000000000b'
          and assigned_user_id = '33333333-3333-3333-3333-333333333333'
          and status = 'closed' and closed_at is not null
   from tickets where id = 'c0000000-0000-0000-0000-000000000001'),
  'security can still reassign, repoint and close a ticket'
);

select pg_temp.act_as_owner();

do $$ begin raise notice '0035 ticket guard checks passed'; end $$;

rollback;
