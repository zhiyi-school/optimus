import type { ControlDetail } from "@/api/playbook-types";
import type { RetestRun, Ticket, TicketControl, TicketControlStep } from "@/data/types";
import {
  activeReassessment,
  AWAITING_SECURITY,
  canEditRemediation,
  canRequestReassessment,
  canSelectApproach,
  effectiveSelectedControlId,
  isReconciled,
  liveControls,
  SECURITY_FINALISED,
  selectableControls,
  selectedApproachComplete,
  selectedControl,
  selectedControlReconciliationPlan,
  selectionWasReplaced,
  type LiveControl,
} from "@/lib/resolve";

export type RemediationReasonCode =
  | "approach_permission"
  | "approach_not_remediation"
  | "approach_withdrawn"
  | "approach_security_finalised"
  | "approach_security_owned"
  | "reassessment_permission"
  | "reassessment_active_queued"
  | "reassessment_active_running"
  | "reassessment_no_remediation"
  | "reassessment_withdrawn"
  | "reassessment_security_finalised"
  | "reassessment_security_owned"
  | "reassessment_wrong_state"
  | "reassessment_loading"
  | "reassessment_load_failed"
  | "reassessment_replaced"
  | "reassessment_no_approach"
  | "reassessment_reconciling"
  | "reassessment_no_steps"
  | "reassessment_incomplete";

export interface RemediationBlock {
  code: RemediationReasonCode;
  completed?: number;
  total?: number;
}

export interface RemediationWorkflowInput {
  ticket: Ticket | null | undefined;
  definitions: ControlDetail[] | undefined;
  definitionsState: "loading" | "error" | "ready";
  controls: TicketControl[] | undefined;
  steps: TicketControlStep[] | undefined;
  controlsLoading: boolean;
  stepsLoading: boolean;
  retests: RetestRun[] | undefined;
  mayEdit: boolean;
  mayRequest: boolean;
}

export interface RemediationWorkflow {
  candidates: ControlDetail[];
  storedControlId: string | null;
  selectedControlId: string | null;
  selected: ControlDetail | undefined;
  replaced: boolean;
  reconciliationPlan: ReturnType<typeof selectedControlReconciliationPlan>;
  reconciled: boolean;
  liveControl: LiveControl | undefined;
  complete: boolean;
  editable: boolean;
  approachChangeBlock: RemediationBlock | null;
  reassessmentBlock: RemediationBlock | null;
}

export function remediationWorkflow(input: RemediationWorkflowInput): RemediationWorkflow {
  const candidates = selectableControls(input.definitions);
  const storedControlId = input.ticket?.selected_control_id ?? null;
  const selectedControlId = effectiveSelectedControlId(storedControlId, candidates);
  const selected = selectedControl(candidates, selectedControlId);
  const replaced = selectionWasReplaced(storedControlId, candidates);
  const reconciliationPlan = selectedControlReconciliationPlan(selected);
  const rowsLoaded = !input.controlsLoading && !input.stepsLoading;
  const reconciled = rowsLoaded && isReconciled(
    reconciliationPlan,
    input.controls ?? [],
    input.steps ?? [],
  );
  const liveControl = selected
    ? liveControls([selected], input.controls ?? [], input.steps ?? [])[0]
    : undefined;

  const approachChangeBlock = approachBlock(input.ticket, input.mayEdit);
  const reassessmentBlock = reassessmentBlockFor({
    ...input,
    replaced,
    reconciled,
    liveControl,
  });

  return {
    candidates,
    storedControlId,
    selectedControlId,
    selected,
    replaced,
    reconciliationPlan,
    reconciled,
    liveControl,
    complete:
      input.definitionsState === "ready" && !replaced && reconciled &&
      selectedApproachComplete(liveControl),
    editable: input.mayEdit && canEditRemediation(input.ticket),
    approachChangeBlock,
    reassessmentBlock,
  };
}

function approachBlock(
  ticket: Ticket | null | undefined,
  mayEdit: boolean,
): RemediationBlock | null {
  if (!mayEdit) return { code: "approach_permission" };
  if (!ticket || ticket.type !== "remediation") return { code: "approach_not_remediation" };
  if (canSelectApproach(ticket)) return null;
  if (ticket.status === "withdrawn") return { code: "approach_withdrawn" };
  if (SECURITY_FINALISED.includes(ticket.status)) return { code: "approach_security_finalised" };
  return { code: "approach_security_owned" };
}

function reassessmentBlockFor(
  input: RemediationWorkflowInput & {
    replaced: boolean;
    reconciled: boolean;
    liveControl: LiveControl | undefined;
  },
): RemediationBlock | null {
  if (!input.mayRequest) return { code: "reassessment_permission" };
  const active = activeReassessment(input.retests);
  if (active?.status === "running") return { code: "reassessment_active_running" };
  if (active) return { code: "reassessment_active_queued" };
  const ticket = input.ticket;
  if (!ticket || ticket.type !== "remediation") return { code: "reassessment_no_remediation" };
  if (ticket.status === "withdrawn") return { code: "reassessment_withdrawn" };
  if (SECURITY_FINALISED.includes(ticket.status)) return { code: "reassessment_security_finalised" };
  if (AWAITING_SECURITY.includes(ticket.status)) return { code: "reassessment_security_owned" };
  if (!canRequestReassessment(ticket)) return { code: "reassessment_wrong_state" };
  if (input.definitionsState === "loading" || input.controlsLoading || input.stepsLoading) {
    return { code: "reassessment_loading" };
  }
  if (input.definitionsState === "error") return { code: "reassessment_load_failed" };
  if (input.replaced) return { code: "reassessment_replaced" };
  if (!input.liveControl) return { code: "reassessment_no_approach" };
  if (!input.reconciled) return { code: "reassessment_reconciling" };
  const { completed, total } = input.liveControl.progress;
  if (total === 0) return { code: "reassessment_no_steps" };
  if (completed < total) return { code: "reassessment_incomplete", completed, total };
  return null;
}
