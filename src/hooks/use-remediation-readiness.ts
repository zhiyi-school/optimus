import { useMemo } from "react";
import {
  useRiskControls,
  useTicketControlSteps,
  useTicketControls,
} from "@/hooks/queries/tickets";
import { remediationWorkflow } from "@/lib/remediation-workflow";
import type { Finding, RetestRun, Ticket } from "@/data/types";

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
    () => remediationWorkflow({
      ticket: input.ticket,
      definitions: definitions.data,
      definitionsState: definitions.isLoading ? "loading" : definitions.isError ? "error" : "ready",
      controls: controls.data,
      steps: steps.data,
      controlsLoading: controls.isLoading,
      stepsLoading: steps.isLoading,
      retests: input.retests,
      mayEdit: input.mayEdit,
      mayRequest: input.mayRequest,
    }),
    [input, definitions.data, definitions.isLoading, definitions.isError, controls.data, controls.isLoading, steps.data, steps.isLoading],
  );
}
