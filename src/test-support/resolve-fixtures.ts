/**
 * Synthetic tickets, control progress rows and playbook control definitions for Resolve rule tests.
 */

import type { ControlDetail } from "@/api/playbook-types";
import type {
  ControlProgressStatus,
  Ticket,
  TicketControl,
  TicketControlStep,
} from "@/data/types";

export const APP = "app-1";
export const ROTATE = "rotate-example-key";
export const REVOKE = "revoke-example-key";

export function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-1",
    finding_id: "finding-1",
    application_id: APP,
    type: "remediation",
    status: "open",
    title: "Remediate: Example finding",
    description: null,
    created_by: "user-1",
    assigned_user_id: null,
    assigned_team_id: null,
    target_version: null,
    risk_conversation_id: "conversation-1",
    origin_assessment_id: "assessment-1",
    withdrawn_at: null,
    withdrawn_by: null,
    withdrawal_reason: null,
    selected_control_id: "example-feature-01-risk-01-control-01",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

export function control(overrides: Partial<TicketControl> = {}): TicketControl {
  return {
    id: "tc-1",
    ticket_id: "ticket-1",
    control_id: "example-feature-01-risk-01-control-01",
    status: "not_started",
    completed_at: null,
    completed_by: null,
    developer_note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function step(
  ticketControlId: string,
  stepKey: string,
  status: ControlProgressStatus = "not_started",
): TicketControlStep {
  return {
    id: `${ticketControlId}-${stepKey}`,
    ticket_control_id: ticketControlId,
    step_key: stepKey,
    status,
    completed_at: null,
    completed_by: null,
    developer_note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

export function definition(overrides: Partial<ControlDetail> = {}): ControlDetail {
  return {
    control_id: "example-feature-01-risk-01-control-01",
    risk_id: "example-feature-01-risk-01",
    platform: "ios",
    title: "Control 1",
    status: "active",
    required: true,
    step_count: 2,
    playbook_revision: "sha256:aaa",
    has_source_archive: false,
    summary: "Example control summary.",
    source_file: "example-feature-01-risk-01-control-01.md",
    status_source: "default",
    intro: [],
    steps: [
      {
        step_key: ROTATE,
        step_id_source: "declared",
        content_hash: "sha256:one",
        step_index: 0,
        number: 1,
        step_title: "First",
        text: "First",
        content: [],
      },
      {
        step_key: REVOKE,
        step_id_source: "declared",
        content_hash: "sha256:two",
        step_index: 1,
        number: 2,
        step_title: "Second",
        text: "Second",
        content: [],
      },
    ],
    references: [],
    source_archives: [],
    source_download_url: null,
    ...overrides,
  };
}
