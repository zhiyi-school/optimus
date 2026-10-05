-- Fresh-install baseline: execute privileges on the workflow RPCs and worker functions.
-- Supabase's default privileges grant new public functions directly to anon, authenticated
-- and service_role, so revoking PUBLIC alone never removes anon's grant.

revoke all on function
  dashboard_metrics(),
  risk_conversation_activity(),
  accept_risk_entry(uuid, uuid, text, uuid),
  retract_risk_acceptance(uuid, text),
  classify_risk(uuid, uuid, text, text),
  classify_risk_entry(uuid, uuid, text, text),
  request_assessment_run(uuid),
  request_new_assessment(uuid, text),
  request_reassessment_entry(uuid, uuid, uuid, text, uuid),
  start_reassessment(uuid),
  withdraw_reassessment(uuid, text)
from public, anon;

grant execute on function
  dashboard_metrics(),
  risk_conversation_activity(),
  accept_risk_entry(uuid, uuid, text, uuid),
  retract_risk_acceptance(uuid, text),
  classify_risk(uuid, uuid, text, text),
  classify_risk_entry(uuid, uuid, text, text),
  request_assessment_run(uuid),
  request_new_assessment(uuid, text),
  request_reassessment_entry(uuid, uuid, uuid, text, uuid),
  start_reassessment(uuid),
  withdraw_reassessment(uuid, text)
to authenticated, service_role;

-- Only the automation backend worker claims and recovers run requests. Reconciliation is
-- internal to the reassessment RPCs, which run as the owner and so keep calling it.
revoke all on function
  claim_assessment_run_request(text, integer),
  recover_expired_assessment_run_leases(),
  reconcile_reassessment_ticket_state(uuid)
from public, anon, authenticated;

grant execute on function
  claim_assessment_run_request(text, integer),
  recover_expired_assessment_run_leases(),
  reconcile_reassessment_ticket_state(uuid)
to service_role;
