import { useEffect, useRef } from "react";
import type { ControlReconciliation } from "@/data/services/controls";
import type { TicketControl, TicketControlStep } from "@/data/types";
import { isReconciled } from "@/lib/resolve";

interface MutationWithSettled<T> {
  mutate: (value: T, options: { onSettled: () => void }) => void;
}

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
  ticketId: string;
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
    persisting.current = true;
    selectControl.mutate(activeControlId, { onSettled: () => (persisting.current = false) });
  }, [ticketId, mayChangeApproach, activeControlId, storedSelection, selectControl]);

  const reconciling = useRef(false);
  useEffect(() => {
    if (!ticketId || !mayChangeApproach || plan.length === 0) return;
    if (controlsLoading || stepsLoading || reconciling.current) return;
    if (isReconciled(plan, controls ?? [], steps ?? [])) return;
    reconciling.current = true;
    reconcile.mutate(plan, { onSettled: () => (reconciling.current = false) });
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
