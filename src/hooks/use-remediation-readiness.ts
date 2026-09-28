import { useMemo } from "react";
import {
  useRiskControls,
  useTicketControlSteps,
  useTicketControls,
} from "@/hooks/queries/tickets";
import { createDebug } from "@/lib/debug";
import { remediationWorkflow } from "@/lib/remediation-workflow";
import type { Finding, RetestRun, Ticket } from "@/data/types";

const debug = createDebug("hooks:remediation-readiness");

export function useRemediationReadiness(input: {
  ticket: Ticket | null | undefined;
  finding: Finding | null | undefined;
  retests: RetestRun[] | undefined;
  mayEdit: boolean;
  mayRequest: boolean;
}) {
  const definitions = useRiskControls(input.finding?.platform, input.finding?.test_id);
  const controls = useTicketControls(input.ticket?.id);
  const steps = useTicketControlSteps(input.ticket?.id);

  return useMemo(
    () => {
      const definitionsState = definitions.isLoading ? "loading" : definitions.isError ? "error" : "ready";
      const workflow = remediationWorkflow({
        ticket: input.ticket,
        definitions: definitions.data,
        definitionsState,
        controls: controls.data,
        steps: steps.data,
        controlsLoading: controls.isLoading,
        stepsLoading: steps.isLoading,
        retests: input.retests,
        mayEdit: input.mayEdit,
        mayRequest: input.mayRequest,
      });
      debug("computes readiness", {
        ticketId: input.ticket?.id,
        findingId: input.finding?.id,
        definitionsState,
        definitionCount: definitions.data?.length,
        controlCount: controls.data?.length,
        stepCount: steps.data?.length,
        controlsLoading: controls.isLoading,
        stepsLoading: steps.isLoading,
        retestCount: input.retests?.length,
        mayEdit: input.mayEdit,
        mayRequest: input.mayRequest,
      });
      return workflow;
    },
    [input, definitions.data, definitions.isLoading, definitions.isError, controls.data, controls.isLoading, steps.data, steps.isLoading],
  );
}
