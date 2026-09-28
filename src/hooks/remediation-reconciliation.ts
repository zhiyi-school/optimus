/**
 * Hook that persists the selected remediation approach and reconciles control progress.
 */

import { useEffect, useRef } from "react";
import type { ControlReconciliation } from "@/data/services/controls";
import type { TicketControl, TicketControlStep } from "@/data/types";
import { createDebug } from "@/lib/debug";
import { isReconciled } from "@/lib/resolve";

const debug = createDebug("hooks:remediation-reconciliation");

interface MutationWithSettled<T> {
  mutate: (value: T, options: { onSettled: () => void }) => void;
}

/** Persists the active control selection and reconciles progress to the plan, one mutation in flight at a time. */
export function useRemediationReconciliation({
  ticketId,
  mayChangeApproach,
  activeControlId,
  storedSelection,
  plan,
  controls,
  steps,
  controlsLoading,
  stepsLoading,
  selectControl,
  reconcile,
}: {
  ticketId: string | undefined;
  mayChangeApproach: boolean;
  activeControlId: string | null;
  storedSelection: string | null;
  plan: ControlReconciliation[];
  controls: TicketControl[] | undefined;
  steps: TicketControlStep[] | undefined;
  controlsLoading: boolean;
  stepsLoading: boolean;
  selectControl: MutationWithSettled<string>;
  reconcile: MutationWithSettled<ControlReconciliation[]>;
}) {
  const persisting = useRef(false);
  useEffect(() => {
    if (!ticketId || !mayChangeApproach || !activeControlId) return;
    if (storedSelection === activeControlId || persisting.current) return;
    debug("persists selected approach", { ticketId, activeControlId, storedSelection });
    persisting.current = true;
    selectControl.mutate(activeControlId, {
      onSettled: () => {
        debug("selected approach settled", { ticketId, activeControlId });
        persisting.current = false;
      },
    });
  }, [ticketId, mayChangeApproach, activeControlId, storedSelection, selectControl]);

  const reconciling = useRef(false);
  useEffect(() => {
    if (!ticketId || !mayChangeApproach || plan.length === 0) return;
    if (controlsLoading || stepsLoading || reconciling.current) return;
    if (isReconciled(plan, controls ?? [], steps ?? [])) {
      debug("progress already reconciled", { ticketId, planSize: plan.length });
      return;
    }
    debug("reconciles progress", {
      ticketId,
      planSize: plan.length,
      controlCount: controls?.length ?? 0,
      stepCount: steps?.length ?? 0,
    });
    reconciling.current = true;
    reconcile.mutate(plan, {
      onSettled: () => {
        debug("reconciliation settled", { ticketId });
        reconciling.current = false;
      },
    });
  }, [
    ticketId,
    mayChangeApproach,
    plan,
    controls,
    controlsLoading,
    steps,
    stepsLoading,
    reconcile,
  ]);
}
