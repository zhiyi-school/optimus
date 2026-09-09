do $$
declare
  missing text;
begin
  select string_agg(name, ', ') into missing
  from unnest(array[
    'applications', 'profiles', 'teams', 'assessments', 'findings', 'tickets',
    'ticket_controls', 'ticket_control_steps', 'risk_conversations',
    'risk_conversation_entries', 'risk_conversation_attachments', 'retest_runs',
    'assessment_run_requests'
  ]) name
  where to_regclass('public.' || name) is null;
  if missing is not null then raise exception 'missing tables: %', missing; end if;

  if not exists (
    select 1 from pg_class where oid = 'public.ticket_control_steps'::regclass and relrowsecurity
  ) then raise exception 'ticket_control_steps RLS is not enabled'; end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'risk_conversation_attachments'
  ) then raise exception 'attachment RLS policies are missing'; end if;
  if to_regprocedure('public.classify_risk_entry(uuid,uuid,text,text)') is null then
    raise exception 'classify_risk_entry is missing';
  end if;
  if to_regprocedure('public.withdraw_reassessment(uuid,text)') is null then
    raise exception 'withdraw_reassessment is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'risk_conversation_attachments'
      and column_name = 'storage_provider'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'risk_conversation_attachments'
      and column_name = 'size_bytes'
  ) then raise exception 'attachment provider columns are missing'; end if;
  if not has_function_privilege('authenticated', 'public.classify_risk_entry(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'authenticated lacks classify_risk_entry execute grant';
  end if;
  if has_function_privilege('anon', 'public.classify_risk_entry(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'anon unexpectedly has classify_risk_entry execute grant';
  end if;
  if has_function_privilege('anon', 'public.request_assessment_run(uuid)', 'EXECUTE') then
    raise exception 'anon unexpectedly has request_assessment_run execute grant';
  end if;
  if has_function_privilege('anon', 'public.start_reassessment(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.withdraw_reassessment(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.classify_risk(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'anon unexpectedly has workflow function execution';
  end if;
  if not has_function_privilege('authenticated', 'public.request_assessment_run(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.start_reassessment(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.withdraw_reassessment(uuid,text)', 'EXECUTE') then
    raise exception 'authenticated lacks workflow function execution';
  end if;
  if has_function_privilege('authenticated', 'public.claim_assessment_run_request(text,integer)', 'EXECUTE') then
    raise exception 'authenticated unexpectedly has worker claim execute grant';
  end if;
  if has_function_privilege('authenticated', 'public.recover_expired_assessment_run_leases()', 'EXECUTE') then
    raise exception 'authenticated unexpectedly has worker recovery execute grant';
  end if;
  if not has_function_privilege('service_role', 'public.claim_assessment_run_request(text,integer)', 'EXECUTE') then
    raise exception 'service_role lacks worker claim execute grant';
  end if;
  if not has_function_privilege('service_role', 'public.recover_expired_assessment_run_leases()', 'EXECUTE') then
    raise exception 'service_role lacks worker recovery execute grant';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'risk_conversation_attachments_storage_path_relative'
  ) then raise exception 'attachment storage-path constraint is missing'; end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'ticket_control_steps_unique_per_control'
  ) then raise exception 'step identity index is missing'; end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_enforce_retest_request_permissions' and not tgisinternal
  ) then raise exception 'effective reassessment trigger is missing'; end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
  ) then raise exception 'storage object policies are missing'; end if;
end $$;
