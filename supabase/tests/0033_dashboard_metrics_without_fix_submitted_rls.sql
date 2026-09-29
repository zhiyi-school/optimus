-- dashboard_metrics() without the retired fix_submitted count (migration 0033).
--
-- Run through `npm run test:database`, which applies it to a disposable
-- database only. It creates its own fixtures and ends with `rollback`. A failed
-- assertion raises and aborts; a clean run prints "0033 dashboard metrics
-- checks passed". All identifiers are placeholders.

begin;

create or replace function pg_temp.assert(condition boolean, description text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'FAILED: %', description;
  end if;
  raise notice 'ok: %', description;
end;
$$;

insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
        'authenticated', 'authenticated', 'developer@example.test');

insert into applications (id, external_id, name, platform) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app', 'Example Application', 'ios');

insert into findings (id, application_id, test_id, title, severity, status, platform) values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'example-feature-01-risk-01', 'Example finding', 'high', 'at_risk', 'ios');

insert into tickets (finding_id, application_id, type, status, title, created_by) values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'remediation', 'in_progress', 'Example remediation', '11111111-1111-1111-1111-111111111111'),
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'remediation', 'retest_requested', 'Example reassessment', '11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  (select array_agg(key order by key) from jsonb_object_keys(dashboard_metrics() -> 'ticketCounts') key)
    = array['accepted', 'closed', 'in_progress', 'open', 'rejected', 'retest_in_progress',
            'retest_requested', 'under_review'],
  'ticketCounts lists every current status and no fix_submitted count'
);

select pg_temp.assert(
  (dashboard_metrics() -> 'ticketCounts' ->> 'in_progress')::int = 1
    and (dashboard_metrics() -> 'ticketCounts' ->> 'retest_requested')::int = 1
    and (dashboard_metrics() ->> 'retestPending')::int = 1
    and (dashboard_metrics() ->> 'openRemediation')::int = 2,
  'the remaining counts are unchanged'
);

select pg_temp.assert(
  (select array_agg(key order by key) from jsonb_object_keys(dashboard_metrics()) key)
    = array['acceptedRisks', 'applicationsCount', 'assessmentsCount', 'assessmentsRunning',
            'criticalFindings', 'findingCounts', 'highFindings', 'openRemediation',
            'retestPending', 'riskAcceptancePending', 'ticketCounts'],
  'the top-level response shape is unchanged'
);

select pg_temp.assert(
  has_function_privilege('authenticated', 'public.dashboard_metrics()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.dashboard_metrics()', 'EXECUTE'),
  'the 0014/0015 grants survive: signed-in callers only'
);

do $$ begin raise notice '0033 dashboard metrics checks passed'; end $$;

rollback;
