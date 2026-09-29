/**
 * Query and mutation hooks for a ticket's control progress and its selected remediation approach.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { controlProgressData, type ControlReconciliation } from "@/data/services/controls";
import { ticketData } from "@/data/services/tickets";
import type { ControlProgressStatus, TicketControl, TicketControlStep } from "@/data/types";
import { useInvalidateQueries } from "./invalidation";
import { controlProgressInvalidationKeys, ticketLifecycleInvalidationKeys } from "./invalidation-rules";
import { ticketKeys } from "@/hooks/query-keys";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:control-progress");

/** Fetches a ticket's control progress rows. */
export function useTicketControls(ticketId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.controls(ticketId),
    queryFn: async () => {
      debug("fetches ticket controls", { ticketId });
      const rows = await controlProgressData.listForTicket(ticketId as string);
      debug("fetched ticket controls", { ticketId, count: rows.length });
      return rows;
    },
    enabled: !!ticketId,
  });
}

/** Fetches a ticket's control step progress rows. */
export function useTicketControlSteps(ticketId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.controlSteps(ticketId),
    queryFn: async () => {
      debug("fetches ticket control steps", { ticketId });
      const rows = await controlProgressData.listStepsForTicket(ticketId as string);
      debug("fetched ticket control steps", { ticketId, count: rows.length });
      return rows;
    },
    enabled: !!ticketId,
  });
}

/** Fetches control and step progress for several tickets, combining their loading and error state. */
export function useControlProgressForTickets(ticketIds: string[]) {
  const key = [...ticketIds].sort();
  const controls = useQuery({
    queryKey: ticketKeys.controlsBulk(key),
    queryFn: async () => {
      debug("fetches bulk controls", { ticketCount: key.length });
      const rows = await controlProgressData.listForTicketIds(key);
      debug("fetched bulk controls", { ticketCount: key.length, count: rows.length });
      return rows;
    },
    enabled: key.length > 0,
  });

  const controlRowIds = (controls.data ?? []).map((control) => control.id).sort();
  const steps = useQuery({
    queryKey: ticketKeys.controlStepsBulk(controlRowIds),
    queryFn: async () => {
      debug("fetches bulk control steps", { controlCount: controlRowIds.length });
      const rows = await controlProgressData.listStepsForControlIds(controlRowIds);
      debug("fetched bulk control steps", { controlCount: controlRowIds.length, count: rows.length });
      return rows;
    },
    enabled: controlRowIds.length > 0,
  });

  return {
    controls: controls.data ?? EMPTY_CONTROLS,
    steps: steps.data ?? EMPTY_STEPS,
    isLoading: controls.isLoading || steps.isLoading,
    isError: controls.isError || steps.isError,
  };
}

const EMPTY_CONTROLS: TicketControl[] = [];
const EMPTY_STEPS: TicketControlStep[] = [];

/** Selects a ticket's remediation control optimistically, restoring the cached ticket if the write fails. */
export function useSelectRemediationControl(
  ticketId: string | undefined,
  findingId: string | null | undefined,
) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateQueries();
  const key = ticketKeys.detail(ticketId);
  return useMutation({
    mutationFn: (controlId: string) =>
      ticketData.setSelectedControl(ticketId as string, controlId),
    onMutate: async (controlId: string) => {
      debug("selects remediation control optimistically", { ticketId, controlId });
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (current: unknown) =>
        current ? { ...(current as object), selected_control_id: controlId } : current,
      );
      return { previous };
    },
    onError: (error, controlId, context) => {
      debug("select remediation control failed, rolls back", { ticketId, controlId, restored: Boolean(context), error });
      if (context) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: () =>
      invalidate([
        ...controlProgressInvalidationKeys(ticketId as string),
        ...ticketLifecycleInvalidationKeys(ticketId as string, findingId),
      ]),
  });
}

/** Applies a reconciliation plan to a ticket's control progress. */
export function useReconcileTicketControls(ticketId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (plan: ControlReconciliation[]) =>
      controlProgressData.reconcile(ticketId as string, plan),
    onMutate: (plan) => debug("reconciles ticket controls", { ticketId, planSize: plan.length }),
    onError: (error) => debug("reconcile ticket controls failed", { ticketId, error }),
    onSuccess: () => invalidate(controlProgressInvalidationKeys(ticketId as string)),
  });
}

/** Sets a control step's progress status and refreshes control progress. */
export function useSetControlStepStatus(ticketId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (input: { stepId: string; status: ControlProgressStatus; note?: string }) =>
      controlProgressData.setStepStatus(
        ticketId as string,
        input.stepId,
        input.status,
        input.note,
      ),
    onMutate: (input) =>
      debug("sets step status", { ticketId, stepId: input.stepId, status: input.status, hasNote: Boolean(input.note) }),
    onError: (error, input) => debug("set step status failed", { ticketId, stepId: input.stepId, error }),
    onSuccess: () => invalidate(controlProgressInvalidationKeys(ticketId as string)),
  });
}
