export type UserRole = "developer" | "security" | "cio" | "admin";

export type TeamType = "developer" | "security" | "management";

export type Platform = "ios" | "android";

export type AssessmentStatus = "queued" | "waiting" | "running" | "completed" | "failed";

export type AssessmentRunRequestStatus =
  | "queued"
  | "waiting"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AssessmentRunRequest {
  id: string;
  assessment_id: string;
  application_id: string;
  platform: Platform;
  status: AssessmentRunRequestStatus;
  attempts: number;
  next_attempt_at: string;
  claimed_at: string | null;
  lease_expires_at: string | null;
  worker_id: string | null;
  blocker_code: string | null;
  last_error: string | null;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export type FindingStatus = "at_risk" | "reduced_risk" | "inconclusive";

export type TicketType =
  | "remediation"
  | "risk_acceptance"
  | "retest_request"
  | "app_provisioning";

export type TicketStatus =
  | "open"
  | "in_progress"
  | "fix_submitted"
  | "retest_requested"
  | "retest_in_progress"
  | "under_review"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "closed";

export type RiskAcceptanceDecision = "pending" | "accepted" | "rejected";

export type RetestStatus = "queued" | "running" | "completed" | "failed";

export type ControlProgressStatus = "not_started" | "in_progress" | "completed" | "needs_changes";

export interface Profile {
  id: string;
  display_name: string;
  email: string;
  roles: UserRole[];
  team_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  type: TeamType;
  created_at: string;
}

export interface Application {
  id: string;
  external_id: string | null;
  name: string;
  platform: Platform;
  version: string | null;
  identifier: string | null;
  developer_team_id: string | null;
  app_type: string | null;
  contact_emails: string[];
  owner_name: string | null;
  owner_email: string | null;
  developer_contact_name: string | null;
  developer_contact_email: string | null;
  provisioning_status: "pending" | "ready" | "failed" | null;
  provisioning_error: string | null;
  artifact_sha256: string | null;
  /** Logical reference into the automation backend's icon store, never a URL or image data. */
  icon_ref: string | null;
  icon_extraction_status: "available" | "unavailable" | "failed" | null;
  created_at: string;
  updated_at: string;
}

export interface Assessment {
  id: string;
  external_id: string;
  application_id: string;
  status: AssessmentStatus;
  total_tests: number;
  completed_tests: number;
  created_at: string;
  updated_at: string;
}

export interface Finding {
  id: string;
  external_id: string | null;
  application_id: string;
  assessment_id: string | null;
  test_id: string | null;
  latest_test_run_id: string | null;
  title: string;
  description: string | null;
  impact: string | null;
  severity: string | null;
  status: FindingStatus;
  platform: Platform;
  created_at: string;
  updated_at: string;
}

export interface FindingHistory {
  id: string;
  finding_id: string;
  previous_status: FindingStatus | null;
  new_status: FindingStatus;
  changed_by: string | null;
  reason: string | null;
  created_at: string;
}

export interface Ticket {
  id: string;
  finding_id: string | null;
  application_id: string;
  type: TicketType;
  status: TicketStatus;
  title: string;
  description: string | null;
  created_by: string;
  assigned_user_id: string | null;
  assigned_team_id: string | null;
  target_version: string | null;
  risk_conversation_id: string | null;
  origin_assessment_id: string | null;
  /** Logical reference to a backend playbook control; no playbook content is stored. */
  selected_control_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  withdrawn_at: string | null;
  withdrawn_by: string | null;
  withdrawal_reason: string | null;
}

export type RiskConversationEntryKind =
  | "message"
  | "classification_changed"
  | "retest_requested"
  | "retest_started"
  | "retest_completed"
  | "retest_failed"
  | "remediation_started"
  | "remediation_withdrawn"
  | "fix_submitted";

export interface RiskConversation {
  id: string;
  application_id: string;
  risk_id: string;
  origin_assessment_id: string | null;
  finding_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RiskConversationEntry {
  id: string;
  conversation_id: string;
  kind: RiskConversationEntryKind;
  author_id: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  source_ticket_id: string | null;
  created_at: string;
  seq: number;
}

export interface RiskConversationAttachment {
  id: string;
  entry_id: string;
  uploaded_by: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  created_at: string;
}

export interface Evidence {
  id: string;
  finding_id: string | null;
  ticket_id: string | null;
  test_run_id: string | null;
  type: string;
  name: string;
  source: string;
  storage_path: string | null;
  external_url: string | null;
  text_content: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RetestRun {
  id: string;
  conversation_id: string | null;
  ticket_id: string | null;
  finding_id: string;
  external_test_run_id: string | null;
  requested_by: string;
  executed_by: string | null;
  status: RetestStatus;
  result: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RiskAcceptance {
  id: string;
  ticket_id: string;
  finding_id: string;
  requested_by: string;
  reason: string;
  business_justification: string | null;
  compensating_controls: string | null;
  expires_at: string | null;
  reviewed_by: string | null;
  decision: RiskAcceptanceDecision | null;
  review_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface TicketControl {
  id: string;
  ticket_id: string;
  control_id: string;
  status: ControlProgressStatus;
  completed_at: string | null;
  completed_by: string | null;
  developer_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketControlStep {
  id: string;
  ticket_control_id: string;
  step_key: string;
  status: ControlProgressStatus;
  completed_at: string | null;
  completed_by: string | null;
  developer_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityLogEntry {
  id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
