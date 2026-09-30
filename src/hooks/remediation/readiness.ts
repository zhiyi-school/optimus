/**
 * Hook deriving remediation workflow readiness from ticket, control and retest data.
 */

import { useMemo } from "react";
import { useTicketControlSteps, useTicketControls } from "@/hooks/queries/control-progress";
import { useRiskControls } from "@/hooks/queries/playbook";
import { createDebug } from "@/lib/debug";
import { remediationWorkflow } from "@/domain/remediation/workflow";
import type { Finding, RetestRun, Ticket } from "@/database/types";

const debug = createDebug("hooks:remediation:readiness");

/** Loads risk controls, ticket controls and steps, and computes the remediation workflow state. */
export function useRemediationReadiness({
  ticketId,
  ticket,
  finding,
  retests,
  mayEdit,
  mayRequest,
}: {
  ticketId: string | undefined;
  ticket: Ticket | null | undefined;
  finding: Finding | null | undefined;
  retests: RetestRun[] | undefined;
  mayEdit: boolean;
  mayRequest: boolean;
}) {
  const definitions = useRiskControls(finding?.platform, finding?.test_id);
  // Keyed by ticketId, not ticket.id, so progress loads in parallel with the ticket.
  const controls = useTicketControls(ticketId);
  const steps = useTicketControlSteps(ticketId);

  const workflow = useMemo(() => {
    const definitionsState = definitions.isLoading ? "loading" : definitions.isError ? "error" : "ready";
    const result = remediationWorkflow({
      ticket,
      definitions: definitions.data,
      definitionsState,
      controls: controls.data,
      steps: steps.data,
      controlsLoading: controls.isLoading,
      stepsLoading: steps.isLoading,
      retests,
      mayEdit,
      mayRequest,
    });
    debug("computes readiness", {
      ticketId,
      findingId: finding?.id,
      definitionsState,
      definitionCount: definitions.data?.length,
      controlCount: controls.data?.length,
      stepCount: steps.data?.length,
      controlsLoading: controls.isLoading,
      stepsLoading: steps.isLoading,
      retestCount: retests?.length,
      mayEdit,
      mayRequest,
    });
    return result;
  }, [
    ticketId,
    ticket,
    finding?.id,
    retests,
    mayEdit,
    mayRequest,
    definitions.data,
    definitions.isLoading,
    definitions.isError,
    controls.data,
    controls.isLoading,
    steps.data,
    steps.isLoading,
  ]);

  return { workflow, definitions, controls, steps };
}
