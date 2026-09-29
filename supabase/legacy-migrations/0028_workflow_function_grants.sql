-- Supabase grants new public-schema functions directly to anon, authenticated,
-- and service_role through default privileges. Revoking PUBLIC alone therefore
-- does not remove anon's direct grant.

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.request_assessment_run(uuid)',
    'public.start_reassessment(uuid)',
    'public.withdraw_reassessment(uuid,text)',
    'public.classify_risk_entry(uuid,uuid,text,text)',
    'public.classify_risk(uuid,uuid,text,text)'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format('revoke execute on function %s from anon', signature);
    end if;
  end loop;

  foreach signature in array array[
    'public.claim_assessment_run_request(text,integer)',
    'public.recover_expired_assessment_run_leases()'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format('revoke execute on function %s from anon, authenticated', signature);
      execute format('grant execute on function %s to service_role', signature);
    end if;
  end loop;
end $$;
