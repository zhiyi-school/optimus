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
  if has_function_privilege('authenticated', 'public.reconcile_reassessment_ticket_state(uuid)', 'EXECUTE') then
    raise exception 'authenticated unexpectedly has reconcile execute grant';
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
  if (select count(*) from storage.buckets
      where id in ('ticket-attachments', 'evidence') and not public) <> 2 then
    raise exception 'the private storage buckets are missing';
  end if;
  if exists (select 1 from tickets where status = 'fix_submitted')
     or exists (select 1 from retest_runs where previous_ticket_status = 'fix_submitted') then
    raise exception 'rows still carry the retired fix_submitted status';
  end if;
  if exists (
    select 1 from pg_constraint
    where conname in ('tickets_status_check', 'retest_runs_previous_ticket_status_check')
      and pg_get_constraintdef(oid) like '%fix_submitted%'
  ) then raise exception 'a ticket status constraint still accepts fix_submitted'; end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'risk_conversation_entries'
      and policyname = 'risk_conversation_entries_insert' and with_check like '%fix_submitted%'
  ) then raise exception 'clients can still record fix_submitted events'; end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%fix_submitted%'
  ) then raise exception 'a database function still names fix_submitted'; end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'risk_conversation_entries_kind_check'
      and pg_get_constraintdef(oid) like '%fix_submitted%'
  ) then raise exception 'historical fix_submitted events are no longer a legal kind'; end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_ticket_update_permissions'
      and p.prosrc like '%new.created_by is distinct from old.created_by%'
      and p.prosrc like '%new.assigned_user_id is distinct from old.assigned_user_id%'
      and p.prosrc like '%withdrawal details are recorded once%'
      and p.prosrc like '%only the security team can close or reopen a ticket%'
  ) then raise exception 'the ticket trigger has lost its ownership, closure or withdrawal guards'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_run_requests'
      and column_name = 'run_id' and data_type = 'text'
  ) then raise exception 'assessment run requests cannot record their run'; end if;
  if to_regprocedure('public.accept_risk_entry(uuid,uuid,text,uuid)') is null
     or to_regprocedure('public.retract_risk_acceptance(uuid,text)') is null then
    raise exception 'the risk acceptance functions are missing';
  end if;
  if has_function_privilege('anon', 'public.accept_risk_entry(uuid,uuid,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.retract_risk_acceptance(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.accept_risk_entry(uuid,uuid,text,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.retract_risk_acceptance(uuid,text)', 'EXECUTE') then
    raise exception 'the risk acceptance function grants are wrong';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'risk_conversation_entries_kind_check'
      and pg_get_constraintdef(oid) like '%risk_accepted%'
      and pg_get_constraintdef(oid) like '%risk_acceptance_retracted%'
      and pg_get_constraintdef(oid) like '%risk_acceptance_ended%'
  ) then raise exception 'risk acceptance events are not a legal conversation kind'; end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'risk_acceptance_one_active_per_finding'
  ) then raise exception 'a risk can hold more than one acceptance in force'; end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_end_risk_acceptance_on_reduced_risk'
      and tgrelid = 'public.finding_history'::regclass
      and tgdeferrable and tginitdeferred and not tgisinternal
  ) then raise exception 'a Reduced Risk result no longer ends an acceptance at commit'; end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_retest_request_permissions'
      and p.prosrc like '%cannot be reassessed until the acceptance is retracted%'
  ) then raise exception 'an accepted risk can still be sent for reassessment'; end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'risk_acceptance'
      and policyname = 'risk_acceptance_insert' and with_check not like '%pending%'
  ) then raise exception 'clients can write an accepted risk directly'; end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'accept_risk_entry'
      and p.prosrc like '%withdrawal_reason = withdrawal%'
  ) then raise exception 'accepting a risk no longer withdraws its remediation'; end if;
  if to_regprocedure('public.risk_conversation_activity()') is null
     or has_function_privilege('anon', 'public.risk_conversation_activity()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.risk_conversation_activity()', 'EXECUTE') then
    raise exception 'risk_conversation_activity is missing or wrongly granted';
  end if;
  if exists (
    select 1 from pg_proc where proname = 'risk_conversation_activity' and prosecdef
  ) then raise exception 'risk_conversation_activity must run as the caller, under RLS'; end if;
  if not exists (
    select 1 from pg_proc where proname = 'risk_conversation_activity'
      and prosrc like '%from findings f%'
  ) then raise exception 'conversation activity no longer counts synced test runs'; end if;
end $$;
