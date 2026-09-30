/**
 * Shared selection, reconciliation and readiness decisions for a remediation's approach.
 */

import type { ControlDetail } from "@/automation-api/playbook-types";
import type { RetestRun, Ticket, TicketControl, TicketControlStep } from "@/database/types";
import {
  canEditRemediation,
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
import { createDebug } from "@/lib/debug";

const debug = createDebug("lib:remediation-workflow");

export type RemediationReasonCode =
  | "approach_permission"
  | "approach_not_remediation"
  | "approach_withdrawn"
  | "approach_security_finalised"
  | "approach_security_owned"
  | "reassessment_permission";

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

/** Derives the selected approach, reconciliation, completion, editability and blocks for a remediation. */
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
  const reassessmentBlock = reassessmentBlockFor(input);

  const workflow = {
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
  debug("decides workflow", {
    ticketId: input.ticket?.id,
    ticketStatus: input.ticket?.status,
    definitionsState: input.definitionsState,
    candidateCount: candidates.length,
    storedControlId,
    selectedControlId,
    replaced,
    planSize: reconciliationPlan.length,
    rowsLoaded,
    reconciled,
    complete: workflow.complete,
    editable: workflow.editable,
    approachChangeBlock: approachChangeBlock?.code ?? null,
    reassessmentBlock: reassessmentBlock?.code ?? null,
  });
  return workflow;
}

/** Why the approach cannot be changed, or null when it can. */
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

/** Why a reassessment cannot be requested, or null when it can. */
function reassessmentBlockFor(input: RemediationWorkflowInput): RemediationBlock | null {
  if (!input.mayRequest) return { code: "reassessment_permission" };
  return null;
}
