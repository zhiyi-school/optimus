import { useCallback } from "react";
import { useRiskControls, useStartRemediation } from "@/hooks/queries/tickets";
import {
  effectiveSelectedControlId,
  selectableControls,
  selectedControl,
  selectedControlReconciliationPlan,
} from "@/lib/resolve";
import type { Finding } from "@/data/types";

/** The remediation a write needs: the existing one, or one opened on the spot. */
export function useEnsureRemediation(finding: Finding | undefined, ticketId: string | undefined) {
  const start = useStartRemediation();
  const definitions = useRiskControls(finding?.platform, finding?.test_id);
  return useCallback(
    async (preferredControlId?: string) => {
      if (ticketId || !finding) return ticketId;
      const candidates = selectableControls(definitions.data);
      const initial = selectedControl(
        candidates,
        effectiveSelectedControlId(preferredControlId, candidates),
      );
      const ticket = await start.mutateAsync({
        ticket: {
          finding_id: finding.id,
          application_id: finding.application_id,
          title: `Remediate: ${finding.title}`,
          selected_control_id: initial?.control_id ?? null,
        },
        plan: selectedControlReconciliationPlan(initial),
        risk: finding.test_id
          ? {
              applicationId: finding.application_id,
              riskId: finding.test_id,
              originAssessmentId: finding.assessment_id,
            }
          : null,
      });
      return ticket.id;
    },
    [ticketId, finding, definitions.data, start],
  );
}
