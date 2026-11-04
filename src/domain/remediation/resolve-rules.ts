/**
 * Pure Resolve workspace rules: status labels, approach selection, progress and ticket workflow gates.
 */

import type {
  ControlDetail,
  ControlStatus,
  ControlStep,
  ControlSummary,
} from "@/automation-api/playbook-types";
import type {
  ControlProgressStatus,
  ControlReconciliation,
  Finding,
  Ticket,
  TicketControl,
  TicketControlStep,
  TicketStatus,
} from "@/database/types";
import type { Tone } from "@/domain/status-labels";
import { createDebug } from "@/lib/debug";

const debug = createDebug("domain:remediation:resolve-rules");

export const developerTicketLabels: Record<TicketStatus, { label: string; tone: Tone }> = {
  open: { label: "Action required", tone: "danger" },
  in_progress: { label: "In progress", tone: "info" },
  retest_requested: { label: "Awaiting reassessment", tone: "warning" },
  retest_in_progress: { label: "Security verification in progress", tone: "warning" },
  under_review: { label: "Under security review", tone: "warning" },
  closed: { label: "Resolved", tone: "success" },
  rejected: { label: "Changes requested", tone: "danger" },
  accepted: { label: "Risk accepted", tone: "success" },
  withdrawn: { label: "Action required", tone: "danger" },
};

/** The finding ids whose risk acceptance is in force, from accepted risk-acceptance tickets. */
export function acceptedFindingIds(tickets: Ticket[] | undefined): Set<string> {
  return new Set(
    (tickets ?? [])
      .filter((ticket) => ticket.type === "risk_acceptance" && ticket.status === "accepted")
      .flatMap((ticket) => (ticket.finding_id ? [ticket.finding_id] : [])),
  );
}

/** The developer-facing label and tone for a ticket status. */
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
const DEVELOPER_ACTIVE: TicketStatus[] = ["in_progress"];

export const SECURITY_FINALISED: TicketStatus[] = ["closed", "accepted"];

export const WITHDRAWABLE_FROM: TicketStatus[] = [
  "open",
  "in_progress",
  "rejected",
];

/** Mirrors `selectable_from` in enforce_ticket_update_permissions: the database is the contract. */
export const APPROACH_SELECTABLE_FROM: TicketStatus[] = [
  "open",
  "in_progress",
  "rejected",
];

export const REMEDIATION_EDITABLE_FROM: TicketStatus[] = ["open", "in_progress", "rejected"];

export interface Progress {
  completed: number;
  total: number;
  ratio: number;
}

/** A completed/total progress value with its ratio (0 when total is 0). */
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

/** The playbook controls a developer may choose as a remediation approach. */
export function selectableControls(
  definitions: ControlDetail[] | undefined,
): ControlDetail[] {
  return (definitions ?? []).filter(isRemediationControl);
}

/** The stored approach when still selectable, else the first candidate, else null. */
export function effectiveSelectedControlId(
  storedControlId: string | null | undefined,
  candidates: ControlDetail[],
): string | null {
  const stored = storedControlId?.trim();
  if (stored && candidates.some((control) => control.control_id === stored)) return stored;
  return candidates[0]?.control_id ?? null;
}

/** The candidate control with this id. */
export function selectedControl(
  candidates: ControlDetail[],
  selectedControlId: string | null,
): ControlDetail | undefined {
  return candidates.find((control) => control.control_id === selectedControlId);
}

/** True when the stored approach is no longer among the selectable controls. */
export function selectionWasReplaced(
  storedControlId: string | null | undefined,
  candidates: ControlDetail[],
): boolean {
  const stored = storedControlId?.trim();
  if (!stored) return false;
  return !candidates.some((control) => control.control_id === stored);
}

/** Joins control definitions with their stored rows and step progress. */
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

/** A control's status derived from its row and step rows; `needs_changes` on the row wins. */
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

/** Step progress summed across controls. */
export function controlProgress(live: LiveControl[]): Progress {
  const total = live.reduce((sum, control) => sum + control.progress.total, 0);
  const completed = live.reduce((sum, control) => sum + control.progress.completed, 0);
  return progress(completed, total);
}

/** Tested risks out of the catalogue; any completed automated test counts, whatever the verdict. */
export function testingProgress(findings: Finding[], catalogueSize: number): Progress {
  const tested = new Set(
    findings.filter((finding) => finding.test_id).map((finding) => finding.test_id as string),
  );
  return progress(tested.size, Math.max(catalogueSize, tested.size));
}

/** Reduced-risk findings out of those that are at risk or reduced risk. */
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
  | "risk_accepted"
  | "action_required";

export const remediationStatusLabels: Record<RemediationStatus, { label: string; tone: Tone }> = {
  no_findings: { label: "Nothing to remediate", tone: "neutral" },
  resolved: { label: "Resolved", tone: "success" },
  changes_requested: { label: "Changes requested", tone: "danger" },
  awaiting_security: { label: "Awaiting security", tone: "warning" },
  in_progress: { label: "In progress", tone: "info" },
  risk_accepted: { label: "Risk accepted", tone: "success" },
  action_required: { label: "Action required", tone: "danger" },
};

export interface ApplicationRemediation {
  applicationId: string;
  affectedFindings: number;
  findingsRequiringAction: number;
  resolvedFindings: number;
  awaitingReassessment: number;
  withdrawnTickets: number;
  findings: Progress;
  tested: Progress;
  controls: Progress;
  status: RemediationStatus;
}

/** Absent when the backend is unreachable, so the dashboard counts every row rather than reporting zero. */
export interface LivePlaybookKeys {
  controlIds: Set<string>;
  stepKeys: Set<string>;
}

/** Summarises an app's findings, remediation tickets and selected-approach step progress; accepted risks need no action. */
export function summarizeApplication(
  applicationId: string,
  findings: Finding[],
  tickets: Ticket[],
  controls: TicketControl[],
  steps: TicketControlStep[],
  liveKeys?: LivePlaybookKeys,
  catalogueSize?: number,
  accepted: Set<string> = new Set(),
): ApplicationRemediation {
  const own = findings.filter((finding) => finding.application_id === applicationId);
  const ownTickets = tickets.filter(
    (ticket) => ticket.application_id === applicationId && ticket.type === "remediation",
  );
  const activeTicketIds = new Set(
    ownTickets.filter((ticket) => ticket.status !== "withdrawn").map((ticket) => ticket.id),
  );
  // Only each active ticket's selected approach counts; alternatives and abandoned approaches stay history.
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
  debug("summarizes application", {
    applicationId,
    findingCount: own.length,
    ticketCount: ownTickets.length,
    openTicketCount: openTickets.length,
    completedSteps,
    stepCount: ownSteps.length,
    liveKeysKnown: Boolean(liveKeys),
  });
  return {
    applicationId,
    affectedFindings: own.filter(
      (finding) => finding.status === "at_risk" || finding.status === "reduced_risk",
    ).length,
    findingsRequiringAction: own.filter(
      (finding) => finding.status === "at_risk" && !accepted.has(finding.id),
    ).length,
    resolvedFindings: own.filter((finding) => finding.status === "reduced_risk").length,
    awaitingReassessment: ownTickets.filter((ticket) => AWAITING_SECURITY.includes(ticket.status))
      .length,
    withdrawnTickets: ownTickets.filter((ticket) => ticket.status === "withdrawn").length,
    findings: findingProgress(own),
    tested: testingProgress(own, catalogueSize ?? 0),
    controls: progress(completedSteps, ownSteps.length),
    status: remediationStatus(own, openTickets, accepted),
  };
}

/** The app's overall remediation status from its findings, open tickets and accepted risks. */
function remediationStatus(
  findings: Finding[],
  openTickets: Ticket[],
  accepted: Set<string>,
): RemediationStatus {
  const actionable = findings.filter(
    (finding) => finding.status === "at_risk" || finding.status === "reduced_risk",
  );
  if (actionable.length === 0) return "no_findings";
  if (actionable.every((finding) => finding.status === "reduced_risk")) return "resolved";
  if (actionable.every((finding) => finding.status === "reduced_risk" || accepted.has(finding.id)))
    return "risk_accepted";
  if (openTickets.some((ticket) => ticket.status === "rejected")) return "changes_requested";
  if (openTickets.some((ticket) => AWAITING_SECURITY.includes(ticket.status)))
    return "awaiting_security";
  if (openTickets.some((ticket) => DEVELOPER_ACTIVE.includes(ticket.status))) return "in_progress";
  return "action_required";
}

/** True for an active, required control. */
export function isRemediationControl(control: ControlSummary | ControlDetail): boolean {
  return control.status === "active" && control.required;
}

/** The control and step keys the selected approach needs stored. */
export function selectedControlReconciliationPlan(
  control: ControlDetail | undefined,
): ControlReconciliation[] {
  if (!control) return [];
  return [
    { control_id: control.control_id, step_keys: control.steps.map((step) => step.step_key) },
  ];
}

/** True when every planned control and step has a stored row. */
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

/** True when a remediation's progress may be edited in its current status. */
export function canEditRemediation(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return REMEDIATION_EDITABLE_FROM.includes(ticket.status);
}

/** True when the approach has steps and all are completed. */
export function selectedApproachComplete(control: LiveControl | undefined): boolean {
  if (!control) return false;
  const { completed, total } = control.progress;
  return total > 0 && completed >= total;
}

/** Whether the remediation approach may still change. */
export function canSelectApproach(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return APPROACH_SELECTABLE_FROM.includes(ticket.status);
}

/** True when a remediation's status allows withdrawing it. */
export function canWithdrawTicket(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return WITHDRAWABLE_FROM.includes(ticket.status);
}

/** True for a withdrawn remediation. */
export function canResumeTicket(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return ticket.status === "withdrawn";
}

/** The finding's non-terminal remediation ticket, if any. */
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

/** The finding's most recently updated withdrawn remediation, if any. */
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

export interface DeveloperRiskRow {
  riskId: string;
  /** The application's finding for the risk; absent while the risk is untested. */
  finding?: Finding;
}

/** Lists every catalogue risk in catalogue order with its finding, as Assess does; findings for risks the catalogue does not list follow at the end. */
export function developerRiskRows(
  risks: { risk_id: string }[] | undefined,
  findings: Finding[] | undefined,
): DeveloperRiskRow[] {
  const byRisk = new Map<string, Finding>();
  for (const finding of findings ?? []) {
    // The first finding wins, matching the one the risk page opens.
    if (finding.test_id && !byRisk.has(finding.test_id)) byRisk.set(finding.test_id, finding);
  }
  const rows: DeveloperRiskRow[] = (risks ?? []).map((risk) => ({
    riskId: risk.risk_id,
    finding: byRisk.get(risk.risk_id),
  }));
  const listed = new Set(rows.map((row) => row.riskId));
  for (const [riskId, finding] of byRisk) {
    if (!listed.has(riskId)) rows.push({ riskId, finding });
  }
  return rows;
}

/** The risk a developer lands on: first needing action, else one being remediated, else the first; null if none. */
export function preferredDeveloperRisk(
  findings: Finding[] | undefined,
  tickets: Ticket[] | undefined,
  accepted: Set<string> = new Set(),
): string | null {
  const linked = (findings ?? []).filter((finding) => finding.test_id);
  const needsAction = linked.find(
    (finding) =>
      finding.status === "at_risk" &&
      !accepted.has(finding.id) &&
      !activeRemediationTicket(finding.id, tickets),
  );
  const inProgress = linked.find((finding) => activeRemediationTicket(finding.id, tickets));
  const riskId = (needsAction ?? inProgress ?? linked[0])?.test_id ?? null;
  debug("prefers developer risk", {
    riskId,
    reason: needsAction ? "needs_action" : inProgress ? "in_progress" : linked[0] ? "first" : "none",
    linkedCount: linked.length,
  });
  return riskId;
}
