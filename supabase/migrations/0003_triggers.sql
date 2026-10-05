-- Fresh-install baseline: row triggers for timestamps, profile creation and workflow guards.

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger trg_applications_updated_at before update on applications
  for each row execute function set_updated_at();
create trigger trg_assessments_updated_at before update on assessments
  for each row execute function set_updated_at();
create trigger trg_findings_updated_at before update on findings
  for each row execute function set_updated_at();
create trigger trg_tickets_updated_at before update on tickets
  for each row execute function set_updated_at();
create trigger trg_risk_conversations_updated_at before update on risk_conversations
  for each row execute function set_updated_at();
create trigger trg_ticket_controls_updated_at before update on ticket_controls
  for each row execute function set_updated_at();
create trigger trg_ticket_control_steps_updated_at before update on ticket_control_steps
  for each row execute function set_updated_at();
create trigger trg_assessment_run_requests_updated_at before update on assessment_run_requests
  for each row execute function set_updated_at();

create trigger trg_prevent_role_escalation before update on profiles
  for each row execute function prevent_role_escalation();

create trigger trg_enforce_assessment_status_transition before update of status on assessments
  for each row execute function enforce_assessment_status_transition();

create trigger trg_enforce_ticket_update_permissions before update on tickets
  for each row execute function enforce_ticket_update_permissions();

create trigger trg_enforce_risk_conversation_identity before update on risk_conversations
  for each row execute function enforce_risk_conversation_identity();

create trigger trg_touch_risk_conversation after insert on risk_conversation_entries
  for each row execute function touch_risk_conversation();

create trigger trg_enforce_retest_request_permissions before insert on retest_runs
  for each row execute function enforce_retest_request_permissions();

-- Deferred to commit so the ending is recorded after the change that caused it.
create constraint trigger trg_end_risk_acceptance_on_reduced_risk
  after insert on finding_history
  deferrable initially deferred
  for each row when (new.new_status = 'reduced_risk')
  execute function end_risk_acceptance_on_reduced_risk();
