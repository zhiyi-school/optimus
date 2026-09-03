import type {
  ControlDetail,
  ControlStatus,
  ControlStep,
  ControlSummary,
} from "@/api/playbook-types";
import type { ControlReconciliation } from "@/data/services/controls";
import type {
  ControlProgressStatus,
  Finding,
  RiskConversation,
  Ticket,
  TicketControl,
  TicketControlStep,
  TicketStatus,
} from "@/data/types";
import type { Tone } from "@/lib/status";

/**
 * The one place a risk conversation lives: a risk page of the application it
 * belongs to. Every assessment of that application reaches the same
 * conversation, so a caller passes the assessment it came from and the
 * conversation's own origin is the fallback.
 */
export function riskConversationPath(
  conversation: Pick<RiskConversation, "risk_id" | "origin_assessment_id">,
  assessmentId?: string | null,
): string | null {
  const assessment = assessmentId ?? conversation.origin_assessment_id;
  return assessment ? `/assessments/${assessment}/tests/${conversation.risk_id}` : null;
}

export const developerTicketLabels: Record<TicketStatus, { label: string; tone: Tone }> = {
  open: { label: "Action required", tone: "danger" },
  in_progress: { label: "In progress", tone: "info" },
  fix_submitted: { label: "Fix submitted", tone: "info" },
  retest_requested: { label: "Awaiting reassessment", tone: "warning" },
  retest_in_progress: { label: "Security verification in progress", tone: "warning" },
  under_review: { label: "Under security review", tone: "warning" },
  closed: { label: "Resolved", tone: "success" },
  rejected: { label: "Changes requested", tone: "danger" },
  accepted: { label: "Risk accepted", tone: "success" },
  withdrawn: { label: "Withdrawn by developer", tone: "neutral" },
};

export function developerTicketLabel(status: TicketStatus | undefined) {
  return status ? developerTicketLabels[status] : undefined;
}

export const controlStatusLabels: Record<ControlProgressStatus, { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  needs_changes: { label: "Changes requested", tone: "danger" },
};

export const playbookControlStatusLabels: Record<ControlStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "info" },
  deprecated: { label: "Deprecated", tone: "neutral" },
  deprioritized: { label: "Deprioritised", tone: "neutral" },
};

export const AWAITING_SECURITY: TicketStatus[] = [
  "retest_requested",
  "retest_in_progress",
  "under_review",
];
const TERMINAL: TicketStatus[] = ["closed", "accepted", "withdrawn"];
const DEVELOPER_ACTIVE: TicketStatus[] = ["in_progress", "fix_submitted"];

export const SECURITY_FINALISED: TicketStatus[] = ["closed", "accepted"];

export const WITHDRAWABLE_FROM: TicketStatus[] = [
  "open",
  "in_progress",
  "fix_submitted",
  "rejected",
];

export interface Progress {
  completed: number;
  total: number;
  ratio: number;
}

function progress(completed: number, total: number): Progress {
  return { completed, total, ratio: total === 0 ? 0 : completed / total };
}

export interface LiveStep {
  step: ControlStep;
  row: TicketControlStep | undefined;
}

export interface LiveControl {
  definition: ControlDetail;
  row: TicketControl | undefined;
  steps: LiveStep[];
  status: ControlProgressStatus;
  progress: Progress;
}

/** The alternatives a developer may pick between, in the backend's own order. */
export function selectableControls(
  definitions: ControlDetail[] | undefined,
): ControlDetail[] {
  return (definitions ?? []).filter(isRemediationControl);
}

/** The stored choice when it is still on offer, otherwise the first alternative. */
export function effectiveSelectedControlId(
  storedControlId: string | null | undefined,
  candidates: ControlDetail[],
): string | null {
  const stored = storedControlId?.trim();
  if (stored && candidates.some((control) => control.control_id === stored)) return stored;
  return candidates[0]?.control_id ?? null;
}

export function selectedControl(
  candidates: ControlDetail[],
  selectedControlId: string | null,
): ControlDetail | undefined {
  return candidates.find((control) => control.control_id === selectedControlId);
}

/** A stored selection the playbook no longer offers: its progress stops counting. */
export function selectionWasReplaced(
  storedControlId: string | null | undefined,
  candidates: ControlDetail[],
): boolean {
  const stored = storedControlId?.trim();
  if (!stored) return false;
  return !candidates.some((control) => control.control_id === stored);
}

/** The playbook decides what exists and in what order; stored rows only say how far the developer got. */
export function liveControls(
  definitions: ControlDetail[] | undefined,
  controls: TicketControl[],
  steps: TicketControlStep[],
): LiveControl[] {
  const rowByControlId = new Map(controls.map((control) => [control.control_id, control]));
  const rowsByControl = new Map<string, Map<string, TicketControlStep>>();
  for (const step of steps) {
    const bucket = rowsByControl.get(step.ticket_control_id) ?? new Map();
    bucket.set(step.step_key, step);
    rowsByControl.set(step.ticket_control_id, bucket);
  }

  return (definitions ?? []).map((definition) => {
    const row = rowByControlId.get(definition.control_id);
    const stepRows = row ? rowsByControl.get(row.id) : undefined;
    const live: LiveStep[] = definition.steps.map((step) => ({
      step,
      row: stepRows?.get(step.step_key),
    }));
    const completed = live.filter((entry) => entry.row?.status === "completed").length;
    return {
      definition,
      row,
      steps: live,
      status: liveControlStatus(row, live.map((entry) => entry.row)),
      progress: progress(completed, live.length),
    };
  });
}

/** Completing every step readies the control for submission; it never closes the finding. */
export function liveControlStatus(
  row: TicketControl | undefined,
  steps: (TicketControlStep | undefined)[],
): ControlProgressStatus {
  if (row?.status === "needs_changes") return "needs_changes";
  if (steps.length === 0) return row?.status ?? "not_started";
  if (steps.every((step) => step?.status === "completed")) return "completed";
  if (steps.some((step) => step && step.status !== "not_started")) return "in_progress";
  return "not_started";
}

/** Completed steps over total steps, across the controls the caller is showing. */
export function controlProgress(live: LiveControl[]): Progress {
  const total = live.reduce((sum, control) => sum + control.progress.total, 0);
  const completed = live.reduce((sum, control) => sum + control.progress.completed, 0);
  return progress(completed, total);
}

/** Only the selected approach counts; alternatives and replaced approaches never do. */
export function selectedControlProgress(
  definitions: ControlDetail[] | undefined,
  selectedControlId: string | null,
  controls: TicketControl[],
  steps: TicketControlStep[],
): LiveControl | undefined {
  const candidates = selectableControls(definitions);
  const chosen = selectedControl(candidates, selectedControlId);
  if (!chosen) return undefined;
  return liveControls([chosen], controls, steps)[0];
}

/** Resolved findings over total actionable findings. */
export function findingProgress(findings: Finding[]): Progress {
  const actionable = findings.filter(
    (finding) => finding.status === "at_risk" || finding.status === "reduced_risk",
  );
  return progress(
    actionable.filter((finding) => finding.status === "reduced_risk").length,
    actionable.length,
  );
}

export type RemediationStatus =
  | "no_findings"
  | "resolved"
  | "changes_requested"
  | "awaiting_security"
  | "in_progress"
  | "action_required";

export const remediationStatusLabels: Record<RemediationStatus, { label: string; tone: Tone }> = {
  no_findings: { label: "Nothing to remediate", tone: "neutral" },
  resolved: { label: "Resolved", tone: "success" },
  changes_requested: { label: "Changes requested", tone: "danger" },
  awaiting_security: { label: "Awaiting security", tone: "warning" },
  in_progress: { label: "In progress", tone: "info" },
  action_required: { label: "Action required", tone: "danger" },
};

export interface ApplicationRemediation {
  applicationId: string;
  affectedFindings: number;
  findingsRequiringAction: number;
  resolvedFindings: number;
  fixesSubmitted: number;
  awaitingReassessment: number;
  withdrawnTickets: number;
  findings: Progress;
  controls: Progress;
  status: RemediationStatus;
  lastUpdatedAt: string | null;
}

/** Absent when the backend is unreachable, so the dashboard counts every row rather than reporting zero. */
export interface LivePlaybookKeys {
  controlIds: Set<string>;
  stepKeys: Set<string>;
}

export function summarizeApplication(
  applicationId: string,
  findings: Finding[],
  tickets: Ticket[],
  controls: TicketControl[],
  steps: TicketControlStep[],
  liveKeys?: LivePlaybookKeys,
): ApplicationRemediation {
  const own = findings.filter((finding) => finding.application_id === applicationId);
  const ownTickets = tickets.filter(
    (ticket) => ticket.application_id === applicationId && ticket.type === "remediation",
  );
  const activeTicketIds = new Set(
    ownTickets.filter((ticket) => ticket.status !== "withdrawn").map((ticket) => ticket.id),
  );
  // Only the approach each active ticket is following counts; alternatives and
  // approaches abandoned by a switch stay as history.
  const selectedByTicket = new Map(
    ownTickets
      .filter((ticket) => activeTicketIds.has(ticket.id) && ticket.selected_control_id)
      .map((ticket) => [ticket.id, ticket.selected_control_id as string]),
  );
  const ownControls = controls.filter(
    (control) =>
      selectedByTicket.get(control.ticket_id) === control.control_id &&
      (!liveKeys || liveKeys.controlIds.has(control.control_id)),
  );
  const controlRowIds = new Set(ownControls.map((control) => control.id));
  const ownSteps = steps.filter(
    (step) =>
      controlRowIds.has(step.ticket_control_id) && (!liveKeys || liveKeys.stepKeys.has(step.step_key)),
  );

  const completedSteps = ownSteps.filter((step) => step.status === "completed").length;

  const openTickets = ownTickets.filter((ticket) => !TERMINAL.includes(ticket.status));
  const lastUpdatedAt = [...own, ...ownTickets]
    .map((row) => row.updated_at)
    .sort()
    .at(-1) ?? null;

  return {
    applicationId,
    affectedFindings: own.filter(
      (finding) => finding.status === "at_risk" || finding.status === "reduced_risk",
    ).length,
    findingsRequiringAction: own.filter((finding) => finding.status === "at_risk").length,
    resolvedFindings: own.filter((finding) => finding.status === "reduced_risk").length,
    fixesSubmitted: ownTickets.filter((ticket) => ticket.status === "fix_submitted").length,
    awaitingReassessment: ownTickets.filter((ticket) => AWAITING_SECURITY.includes(ticket.status))
      .length,
    withdrawnTickets: ownTickets.filter((ticket) => ticket.status === "withdrawn").length,
    findings: findingProgress(own),
    controls: progress(completedSteps, ownSteps.length),
    status: remediationStatus(own, openTickets),
    lastUpdatedAt,
  };
}

function remediationStatus(findings: Finding[], openTickets: Ticket[]): RemediationStatus {
  const actionable = findings.filter(
    (finding) => finding.status === "at_risk" || finding.status === "reduced_risk",
  );
  if (actionable.length === 0) return "no_findings";
  if (actionable.every((finding) => finding.status === "reduced_risk")) return "resolved";
  if (openTickets.some((ticket) => ticket.status === "rejected")) return "changes_requested";
  if (openTickets.some((ticket) => AWAITING_SECURITY.includes(ticket.status)))
    return "awaiting_security";
  if (openTickets.some((ticket) => DEVELOPER_ACTIVE.includes(ticket.status))) return "in_progress";
  return "action_required";
}

/** A live remediation approach: deprecated, deprioritised and non-remediation controls are not on offer. */
export function isRemediationControl(control: ControlSummary | ControlDetail): boolean {
  return control.status === "active" && control.required;
}

/** What a ticket's progress rows should cover: the selected approach's current steps, and nothing else. */
export function selectedControlReconciliationPlan(
  control: ControlDetail | undefined,
): ControlReconciliation[] {
  if (!control) return [];
  return [
    { control_id: control.control_id, step_keys: control.steps.map((step) => step.step_key) },
  ];
}

/** True once the ticket holds a row for every control and step the playbook currently lists. */
export function isReconciled(
  plan: ControlReconciliation[],
  controls: TicketControl[],
  steps: TicketControlStep[],
): boolean {
  const rowByControlId = new Map(controls.map((control) => [control.control_id, control]));
  return plan.every((control) => {
    const row = rowByControlId.get(control.control_id);
    if (!row) return false;
    const stored = new Set(
      steps.filter((step) => step.ticket_control_id === row.id).map((step) => step.step_key),
    );
    return control.step_keys.every((key) => stored.has(key));
  });
}

/** The ticket lifecycle alone: the selected approach is checked by `submitFixBlockedReason`. */
export function canSubmitFix(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return ["open", "in_progress", "rejected"].includes(ticket.status);
}

/** Why the fix cannot be submitted yet, or null when every current selected step is done. */
export function submitFixBlockedReason(
  ticket: Ticket | null | undefined,
  selection: {
    loading: boolean;
    failed?: boolean;
    replaced: boolean;
    control: LiveControl | undefined;
  },
): string | null {
  if (!canSubmitFix(ticket)) return "This remediation is not yours to submit right now.";
  if (selection.loading) return "Loading the remediation approach…";
  if (selection.failed) {
    return "The remediation approach could not be loaded, so completion cannot be checked.";
  }
  if (selection.replaced) {
    return "The approach this ticket was following is no longer in the playbook. Review the replacement before submitting.";
  }
  if (!selection.control) return "Select a remediation approach before submitting a fix.";
  const { completed, total } = selection.control.progress;
  if (total === 0) return "This approach has no steps to complete yet.";
  if (completed < total) return `Complete all ${total} steps of the selected approach first.`;
  return null;
}

export function canRequestReassessment(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return ["fix_submitted", "rejected"].includes(ticket.status);
}

/** Why the reassessment action is unavailable, or null when it can be used. */
export function reassessmentBlockedReason(ticket: Ticket | null | undefined): string | null {
  if (!ticket || ticket.type !== "remediation") {
    return "Start a remediation for this risk and submit your fix, then ask for a reassessment here.";
  }
  if (canRequestReassessment(ticket)) return null;
  if (ticket.status === "withdrawn") {
    return "This remediation was withdrawn. Resume it to work on the risk again.";
  }
  if (AWAITING_SECURITY.includes(ticket.status)) {
    return "Security is already verifying this remediation.";
  }
  if (SECURITY_FINALISED.includes(ticket.status)) {
    return "Security has finished with this remediation.";
  }
  return "Submit your fix on the remediation ticket first, then ask for a reassessment here.";
}

export function canWithdrawTicket(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return WITHDRAWABLE_FROM.includes(ticket.status);
}

export function canResumeTicket(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return ticket.status === "withdrawn";
}

export function activeRemediationTicket(
  findingId: string,
  tickets: Ticket[] | undefined,
): Ticket | undefined {
  return (tickets ?? []).find(
    (ticket) =>
      ticket.finding_id === findingId &&
      ticket.type === "remediation" &&
      !TERMINAL.includes(ticket.status),
  );
}

export function resumableRemediationTicket(
  findingId: string,
  tickets: Ticket[] | undefined,
): Ticket | undefined {
  return (tickets ?? [])
    .filter(
      (ticket) =>
        ticket.finding_id === findingId &&
        ticket.type === "remediation" &&
        ticket.status === "withdrawn",
    )
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .at(-1);
}

/** Session memory only — no playbook state is stored to derive this. */
export function changedSinceCompleted(
  live: LiveStep[],
  hashesAtLoad: Map<string, string> | undefined,
): Set<string> {
  const changed = new Set<string>();
  if (!hashesAtLoad) return changed;
  for (const entry of live) {
    const before = hashesAtLoad.get(entry.step.step_key);
    if (!before) continue;
    if (entry.row?.status === "completed" && before !== entry.step.content_hash) {
      changed.add(entry.step.step_key);
    }
  }
  return changed;
}

export function contentHashes(steps: ControlStep[]): Map<string, string> {
  return new Map(steps.map((step) => [step.step_key, step.content_hash]));
}
