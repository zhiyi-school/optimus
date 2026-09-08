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
  RetestRun,
  Ticket,
  TicketControl,
  TicketControlStep,
  TicketStatus,
} from "@/data/types";
import type { Tone } from "@/lib/status";

export const developerTicketLabels: Record<TicketStatus, { label: string; tone: Tone }> = {
  open: { label: "Action required", tone: "danger" },
  in_progress: { label: "In progress", tone: "info" },
  fix_submitted: { label: "Fix submitted", tone: "neutral" },
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
const DEVELOPER_ACTIVE: TicketStatus[] = ["in_progress"];

export const SECURITY_FINALISED: TicketStatus[] = ["closed", "accepted"];

export const WITHDRAWABLE_FROM: TicketStatus[] = [
  "open",
  "in_progress",
  "fix_submitted",
  "rejected",
];

/** Mirrors `selectable_from` in enforce_ticket_update_permissions: the database is the contract. */
export const APPROACH_SELECTABLE_FROM: TicketStatus[] = [
  "open",
  "in_progress",
  "fix_submitted",
  "rejected",
];

export const REMEDIATION_EDITABLE_FROM: TicketStatus[] = ["open", "in_progress", "rejected"];

/**
 * Mirrors `requestable_from` in enforce_retest_request_permissions. `fix_submitted`
 * is there only so a remediation recorded before the submission step was retired
 * is not stranded; nothing puts a ticket into it any more.
 */
export const REASSESSMENT_REQUESTABLE_FROM: TicketStatus[] = [
  "open",
  "in_progress",
  "rejected",
  "fix_submitted",
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

/** Whether the developer may still record progress against this remediation. */
export function canEditRemediation(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return REMEDIATION_EDITABLE_FROM.includes(ticket.status);
}

/** True once every step the playbook currently lists for the approach is done. */
export function selectedApproachComplete(control: LiveControl | undefined): boolean {
  if (!control) return false;
  const { completed, total } = control.progress;
  return total > 0 && completed >= total;
}

/**
 * Whether the approach may still be changed. Wider than `canEditRemediation`:
 * the database also allows a switch on a legacy `fix_submitted` remediation.
 */
export function canSelectApproach(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return APPROACH_SELECTABLE_FROM.includes(ticket.status);
}

/** Why the approach cannot be changed, or null when it can. */
export function approachChangeBlockedReason(
  ticket: Ticket | null | undefined,
  mayEdit: boolean,
): string | null {
  if (!mayEdit) {
    return "Only the developers assigned to this application can change the remediation approach.";
  }
  if (!ticket || ticket.type !== "remediation") return "This is not a remediation ticket.";
  if (canSelectApproach(ticket)) return null;
  if (ticket.status === "withdrawn") {
    return "This remediation was withdrawn. Resume it to change the approach.";
  }
  if (SECURITY_FINALISED.includes(ticket.status)) {
    return "Security has finished with this remediation, so the approach is fixed.";
  }
  return "Security is verifying this remediation, so the approach cannot be changed until that finishes.";
}

/** The ticket lifecycle alone; completion is checked by `reassessmentBlockedReason`. */
export function canRequestReassessment(ticket: Ticket | null | undefined): boolean {
  if (!ticket || ticket.type !== "remediation") return false;
  return REASSESSMENT_REQUESTABLE_FROM.includes(ticket.status);
}

export interface ReassessmentReadiness {
  ticket: Ticket | null | undefined;
  /** The playbook's approaches for this risk are still being fetched. */
  loading: boolean;
  failed?: boolean;
  /** The stored approach is no longer one the playbook offers. */
  replaced: boolean;
  /** The ticket holds a row for every step of the selected approach. */
  reconciled: boolean;
  control: LiveControl | undefined;
  activeRetest: RetestRun | undefined;
  mayRequest: boolean;
}

/**
 * Why a reassessment cannot be asked for, or null when every condition holds.
 * The database enforces the same completion rule; this only says so first.
 */
export function reassessmentBlockedReason(readiness: ReassessmentReadiness): string | null {
  const { ticket, control, activeRetest } = readiness;

  if (!readiness.mayRequest) {
    return "Only the developers assigned to this application can ask for a reassessment.";
  }
  if (activeRetest) {
    return activeRetest.status === "running"
      ? "Security has already started verifying this remediation."
      : "A reassessment has been requested. Security runs it from this conversation.";
  }
  if (!ticket || ticket.type !== "remediation") {
    return "Start a remediation for this risk and complete its steps, then ask for a reassessment here.";
  }
  if (ticket.status === "withdrawn") {
    return "This remediation was withdrawn. Resume it to work on the risk again.";
  }
  if (SECURITY_FINALISED.includes(ticket.status)) {
    return "Security has finished with this remediation.";
  }
  if (AWAITING_SECURITY.includes(ticket.status)) {
    return "Security is already verifying this remediation.";
  }
  if (!canRequestReassessment(ticket)) {
    return "This remediation is not in a state a reassessment can be asked for.";
  }
  if (readiness.loading) return "Loading the remediation approach…";
  if (readiness.failed) {
    return "The remediation approach could not be loaded, so completion cannot be checked.";
  }
  if (readiness.replaced) {
    return "The approach this remediation was following is no longer in the playbook. Review the replacement first.";
  }
  if (!control) return "Choose a remediation approach and complete its steps first.";
  if (!readiness.reconciled) return "Preparing this approach's steps…";
  const { completed, total } = control.progress;
  if (total === 0) return "This approach has no steps to complete yet.";
  if (completed < total) {
    return `Complete all ${total} steps of the selected approach first — ${completed} done.`;
  }
  return null;
}

/** The reassessment a risk is waiting on: cancelled requests are history, not work. */
export function activeReassessment(retests: RetestRun[] | undefined): RetestRun | undefined {
  return (retests ?? []).find(
    (retest) => retest.status === "queued" || retest.status === "running",
  );
}

/**
 * Withdrawal is the requester's own action on a queued request, and only while
 * its remediation is still the one waiting for it.
 */
export function canWithdrawReassessment(
  retest: RetestRun | null | undefined,
  ticket: Ticket | null | undefined,
  profileId: string | null | undefined,
): boolean {
  if (!retest || retest.status !== "queued") return false;
  if (!profileId || retest.requested_by !== profileId) return false;
  if (!ticket || ticket.type !== "remediation") return false;
  if (retest.ticket_id !== ticket.id) return false;
  return ticket.status === "retest_requested";
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

/**
 * The application's raised risks in the playbook catalogue's own order, so
 * Resolve lists them exactly as Assess does. A finding whose risk the catalogue
 * does not list — an older run, or an unreachable backend — keeps its place at
 * the end rather than disappearing.
 */
export function developerRiskOrder(
  risks: { risk_id: string }[] | undefined,
  findings: Finding[] | undefined,
): Finding[] {
  const linked = (findings ?? []).filter((finding) => finding.test_id);
  const rank = new Map((risks ?? []).map((risk, index) => [risk.risk_id, index]));
  return [...linked].sort((a, b) => {
    const left = rank.get(a.test_id as string) ?? Number.MAX_SAFE_INTEGER;
    const right = rank.get(b.test_id as string) ?? Number.MAX_SAFE_INTEGER;
    return left !== right ? left - right : linked.indexOf(a) - linked.indexOf(b);
  });
}

/**
 * The risk a developer should land on when they open an application: the first
 * finding still needing action, else one they are already remediating, else the
 * first finding at all. Returns null when there is nothing to open.
 */
export function preferredDeveloperRisk(
  findings: Finding[] | undefined,
  tickets: Ticket[] | undefined,
): string | null {
  const linked = (findings ?? []).filter((finding) => finding.test_id);
  const needsAction = linked.find(
    (finding) => finding.status === "at_risk" && !activeRemediationTicket(finding.id, tickets),
  );
  const inProgress = linked.find((finding) => activeRemediationTicket(finding.id, tickets));
  return (needsAction ?? inProgress ?? linked[0])?.test_id ?? null;
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

/** The Description supplies both the title and the summary; show the summary only when it adds something. */
export function controlSummary(control: ControlDetail): string | undefined {
  const summary = (control.summary ?? "").trim();
  return summary && summary !== control.title.trim() ? summary : undefined;
}

export function introRepeatsSummary(control: ControlDetail): boolean {
  if (control.intro.length === 0) return true;
  if (control.intro.length > 1) return false;
  const [block] = control.intro;
  return block.type === "paragraph" && (block.text ?? "").trim() === (control.summary ?? "").trim();
}
