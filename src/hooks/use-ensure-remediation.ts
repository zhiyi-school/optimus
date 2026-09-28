import { useCallback } from "react";
import { useRiskControls, useStartRemediation } from "@/hooks/queries/tickets";
import {
  effectiveSelectedControlId,
  selectableControls,
  selectedControl,
  selectedControlReconciliationPlan,
} from "@/lib/resolve";
import { createDebug } from "@/lib/debug";
import type { Finding } from "@/data/types";

const debug = createDebug("hooks:ensure-remediation");

/** The remediation a write needs: the existing one, or one opened on the spot. */
export function useEnsureRemediation(finding: Finding | undefined, ticketId: string | undefined) {
  const start = useStartRemediation();
  const definitions = useRiskControls(finding?.platform, finding?.test_id);
  return useCallback(
    async (preferredControlId?: string) => {
      if (ticketId || !finding) {
        debug("reuses remediation", { ticketId, hasFinding: Boolean(finding) });
        return ticketId;
      }
      const candidates = selectableControls(definitions.data);
      const initial = selectedControl(
        candidates,
        effectiveSelectedControlId(preferredControlId, candidates),
      );
      debug("starts remediation", {
        findingId: finding.id,
        preferredControlId,
        selectedControlId: initial?.control_id ?? null,
        candidateCount: candidates.length,
      });
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
      debug("started remediation", { findingId: finding.id, ticketId: ticket.id });
      return ticket.id;
    },
    [ticketId, finding, definitions.data, start],
  );
}
