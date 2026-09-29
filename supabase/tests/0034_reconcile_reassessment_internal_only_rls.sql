-- reconcile_reassessment_ticket_state() is internal only (fix 0034).
--
-- Run through `npm run test:database`, which applies it to a disposable
-- database only. It ends with `rollback`. A failed assertion raises and
-- aborts; a clean run prints "0034 reconcile privilege checks passed".

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

select pg_temp.assert(
  not has_function_privilege('authenticated', 'public.reconcile_reassessment_ticket_state(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.reconcile_reassessment_ticket_state(uuid)', 'EXECUTE'),
  'clients cannot call reconcile_reassessment_ticket_state directly'
);

select pg_temp.assert(
  has_function_privilege('service_role', 'public.reconcile_reassessment_ticket_state(uuid)', 'EXECUTE'),
  'the worker role keeps its grant'
);

select pg_temp.assert(
  has_function_privilege('authenticated', 'public.request_reassessment_entry(uuid,uuid,uuid,text,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.start_reassessment(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.withdraw_reassessment(uuid,text)', 'EXECUTE'),
  'the reassessment RPCs that reconcile internally stay callable'
);

set local role authenticated;
do $$
begin
  perform reconcile_reassessment_ticket_state('c0000000-0000-0000-0000-000000000001');
  raise exception 'FAILED: a signed-in client called reconcile_reassessment_ticket_state';
exception when insufficient_privilege then
  raise notice 'ok: a signed-in client is refused permission to call it';
end $$;
reset role;

do $$ begin raise notice '0034 reconcile privilege checks passed'; end $$;

rollback;
