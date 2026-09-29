/**
 * Query and mutation hooks for tickets, remediation controls, risk acceptance, activity and metrics.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activityData } from "@/data/services/activity";
import { controlProgressData, type ControlReconciliation } from "@/data/services/controls";
import { findingData } from "@/data/services/findings";
import { metricsData } from "@/data/services/metrics";
import { riskConversationData } from "@/data/services/conversations";
import { retestData } from "@/data/services/retests";
import { riskAcceptanceData } from "@/data/services/risk-acceptance";
import { ticketData, type TicketFilters } from "@/data/services/tickets";
import { playbookApi } from "@/api/playbook-services";
import type { AutomationPlatform } from "@/api/automation-types";
import type { ControlProgressStatus, FindingStatus, RiskAcceptanceDecision, TicketControl, TicketControlStep, TicketStatus } from "@/data/types";
import { useInvalidateQueries } from "./invalidation";
import {
  controlProgressInvalidationKeys,
  conversationInvalidationKeys,
  ticketLifecycleInvalidationKeys,
} from "./invalidation-rules";
import { automationKeys, ticketKeys } from "@/hooks/query-keys";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:tickets");

/** Fetches a finding's retest runs. */
export function useFindingRetests(findingId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.findingRetests(findingId),
    queryFn: async () => {
      debug("fetches finding retests", { findingId });
      const rows = await retestData.listForFinding(findingId as string);
      debug("fetched finding retests", { findingId, count: rows.length });
      return rows;
    },
    enabled: !!findingId,
  });
}

/** Fetches the tickets linked to a finding. */
export function useFindingTickets(findingId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.byFinding(findingId),
    queryFn: async () => {
      debug("fetches finding tickets", { findingId });
      const rows = await ticketData.list({ findingId });
      debug("fetched finding tickets", { findingId, count: rows.length });
      return rows;
    },
    enabled: !!findingId,
  });
}

/** Fetches the tickets linked to any of the given findings. */
export function useTicketsByFindingIds(findingIds: string[]) {
  return useQuery({
    queryKey: ticketKeys.byFindingIds(findingIds),
    queryFn: async () => {
      debug("fetches tickets by finding ids", { findingCount: findingIds.length });
      const rows = await ticketData.listByFindingIds(findingIds);
      debug("fetched tickets by finding ids", { findingCount: findingIds.length, count: rows.length });
      return rows;
    },
    enabled: findingIds.length > 0,
  });
}

/** Fetches tickets with their relations, filtered as given. */
export function useTickets(filters: TicketFilters = {}) {
  return useQuery({
    queryKey: ticketKeys.withRelations(filters),
    queryFn: async () => {
      debug("fetches tickets", { filters });
      const rows = await ticketData.listWithRelations(filters);
      debug("fetched tickets", { count: rows.length });
      return rows;
    },
  });
}

/** Fetches one ticket with its relations. */
export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: async () => {
      debug("fetches ticket", { ticketId: id });
      const ticket = await ticketData.getWithRelations(id as string);
      debug("fetched ticket", { ticketId: id, found: Boolean(ticket), status: ticket?.status });
      return ticket;
    },
    enabled: !!id,
  });
}

/** Fetches a ticket's risk acceptance. */
export function useRiskAcceptance(ticketId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.acceptance(ticketId),
    queryFn: async () => {
      debug("fetches risk acceptance", { ticketId });
      const acceptance = await riskAcceptanceData.getForTicket(ticketId as string);
      debug("fetched risk acceptance", { ticketId, found: Boolean(acceptance) });
      return acceptance;
    },
    enabled: !!ticketId,
  });
}

/** Fetches pending risk acceptances. */
export function usePendingRiskAcceptance() {
  return useQuery({
    queryKey: ticketKeys.pendingAcceptance(),
    queryFn: async () => {
      debug("fetches pending risk acceptances");
      const rows = await riskAcceptanceData.listPending();
      debug("fetched pending risk acceptances", { count: rows.length });
      return rows;
    },
  });
}

/** Fetches the activity log for an entity. */
export function useActivity(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.activity(entityType, entityId),
    queryFn: async () => {
      debug("fetches activity", { entityType, entityId });
      const rows = await activityData.listForEntity(entityType, entityId as string);
      debug("fetched activity", { entityType, entityId, count: rows.length });
      return rows;
    },
    enabled: !!entityId,
  });
}

/** Fetches the dashboard overview metrics. */
export function useDashboardMetrics() {
  return useQuery({
    queryKey: ticketKeys.metrics(),
    queryFn: async () => {
      debug("fetches dashboard metrics");
      const metrics = await metricsData.getOverview();
      debug("fetched dashboard metrics");
      return metrics;
    },
  });
}

/** Creates a remediation ticket and refreshes ticket lists and metrics. */
export function useCreateRemediationTicket() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ticketData.createRemediationTicket,
    onMutate: (variables) => debug("creates remediation ticket", { findingId: variables.finding_id }),
    onError: (error, variables) =>
      debug("create remediation ticket failed", { findingId: variables.finding_id, error }),
    onSuccess: (_data, variables) =>
      invalidate([
        ["ticketsWithRelations"],
        ["tickets", { findingId: variables.finding_id }],
        ["dashboardMetrics"],
      ]),
  });
}

/** Opens a remediation on the risk's shared conversation, recording its origin assessment, then seeds progress. */
export function useStartRemediation() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: async (input: {
      ticket: Parameters<typeof ticketData.createRemediationTicket>[0];
      plan: ControlReconciliation[];
      risk?: { applicationId: string; riskId: string; originAssessmentId?: string | null } | null;
    }) => {
      debug("starts remediation", {
        findingId: input.ticket.finding_id,
        selectedControlId: input.ticket.selected_control_id,
        planSize: input.plan.length,
        hasRisk: Boolean(input.risk),
      });
      let conversationId: string | null = null;
      if (input.risk) {
        const conversation = await riskConversationData.getOrCreate({
          applicationId: input.risk.applicationId,
          riskId: input.risk.riskId,
          findingId: input.ticket.finding_id,
          originAssessmentId: input.risk.originAssessmentId,
        });
        conversationId = conversation.id;
        debug("resolved remediation conversation", { conversationId, riskId: input.risk.riskId });
      }
      const ticket = await ticketData.createRemediationTicket({
        ...input.ticket,
        risk_conversation_id: conversationId,
        origin_assessment_id: input.risk?.originAssessmentId ?? null,
      });
      debug("created remediation ticket", { ticketId: ticket.id, conversationId });
      if (input.plan.length > 0) {
        await controlProgressData.reconcile(ticket.id, input.plan);
        debug("seeded remediation progress", { ticketId: ticket.id, planSize: input.plan.length });
      }
      return ticket;
    },
    onError: (error, input) => debug("start remediation failed", { findingId: input.ticket.finding_id, error }),
    onSuccess: (ticket) =>
      invalidate([
        ...ticketLifecycleInvalidationKeys(ticket.id, ticket.finding_id),
        ...(ticket.risk_conversation_id
          ? conversationInvalidationKeys(ticket.risk_conversation_id)
          : []),
      ]),
  });
}

/** Withdraws a ticket with a reason and refreshes its lifecycle keys. */
export function useWithdrawTicket(ticketId: string, findingId: string | null | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (reason: string) => ticketData.withdraw(ticketId, reason),
    onMutate: (reason) => debug("withdraws ticket", { ticketId, reasonLength: reason.length }),
    onError: (error) => debug("withdraw ticket failed", { ticketId, error }),
    onSuccess: () => {
      debug("withdrew ticket", { ticketId });
      return invalidate(ticketLifecycleInvalidationKeys(ticketId, findingId));
    },
  });
}

/** Resumes a withdrawn ticket and refreshes its lifecycle keys. */
export function useResumeTicket(ticketId: string, findingId: string | null | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: () => ticketData.resume(ticketId),
    onMutate: () => debug("resumes ticket", { ticketId }),
    onError: (error) => debug("resume ticket failed", { ticketId, error }),
    onSuccess: () => {
      debug("resumed ticket", { ticketId });
      return invalidate(ticketLifecycleInvalidationKeys(ticketId, findingId));
    },
  });
}

/** Creates a risk acceptance ticket and refreshes ticket lists and metrics. */
export function useCreateRiskAcceptanceTicket() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: riskAcceptanceData.createTicket,
    onMutate: (variables) => debug("creates risk acceptance ticket", { findingId: variables.finding_id }),
    onError: (error, variables) =>
      debug("create risk acceptance ticket failed", { findingId: variables.finding_id, error }),
    onSuccess: (_data, variables) =>
      invalidate([
        ["ticketsWithRelations"],
        ["tickets", { findingId: variables.finding_id }],
        ["dashboardMetrics"],
      ]),
  });
}

/** Changes a ticket's status and refreshes the ticket, lists, activity and metrics. */
export function useUpdateTicketStatus(ticketId: string) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (status: TicketStatus) => ticketData.updateStatus(ticketId, status),
    onMutate: (status) => debug("updates ticket status", { ticketId, status }),
    onError: (error, status) => debug("update ticket status failed", { ticketId, status, error }),
    onSuccess: () =>
      invalidate([
        ["ticket", ticketId],
        ["ticketsWithRelations"],
        ["tickets"],
        ["activity", "ticket", ticketId],
        ["dashboardMetrics"],
      ]),
  });
}

/** Reclassifies a finding from the conversation and refreshes finding, ticket and conversation keys. */
export function useClassifyRisk(findingId: string | undefined, conversationId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (input: { status: FindingStatus; reason: string }) =>
      findingData.classify({
        findingId: findingId as string,
        conversationId: conversationId as string,
        status: input.status,
        reason: input.reason,
      }),
    onMutate: (input) =>
      debug("classifies risk", { findingId, conversationId, status: input.status, reasonLength: input.reason.length }),
    onError: (error, input) => debug("classify risk failed", { findingId, status: input.status, error }),
    onSuccess: () =>
      invalidate([
        ["finding", findingId],
        ["findingHistory", findingId],
        ["findings"],
        ["assessment"],
        ["ticketsWithRelations"],
        ["tickets"],
        ["dashboardMetrics"],
        ...(conversationId ? conversationInvalidationKeys(conversationId) : []),
      ]),
  });
}

/** Records a risk acceptance decision and refreshes the ticket, acceptances and metrics. */
export function useReviewRiskAcceptance() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      ticketId: string;
      decision: RiskAcceptanceDecision;
      comment?: string;
    }) => riskAcceptanceData.review(id, decision, comment),
    onMutate: (variables) =>
      debug("reviews risk acceptance", { id: variables.id, ticketId: variables.ticketId, decision: variables.decision }),
    onError: (error, variables) =>
      debug("review risk acceptance failed", { id: variables.id, ticketId: variables.ticketId, error }),
    onSuccess: (_data, variables) =>
      invalidate([
        ["ticket", variables.ticketId],
        ["ticketsWithRelations"],
        ["riskAcceptance", variables.ticketId],
        ["riskAcceptancePending"],
        ["dashboardMetrics"],
      ]),
  });
}


/** Fetches the playbook controls that mitigate a risk. */
export function useRiskControls(
  platform: AutomationPlatform | undefined,
  riskId: string | null | undefined,
) {
  return useQuery({
    queryKey: automationKeys.riskControls(platform, riskId),
    queryFn: async () => {
      debug("fetches risk controls", { platform, riskId });
      const controls = await playbookApi.listRiskControls(platform as AutomationPlatform, riskId as string);
      debug("fetched risk controls", { platform, riskId, count: controls.length });
      return controls;
    },
    enabled: !!platform && !!riskId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Fetches one control definition from the playbook. */
export function useControlDetail(
  platform: AutomationPlatform | undefined,
  controlId: string | undefined,
) {
  return useQuery({
    queryKey: automationKeys.control(platform, controlId),
    queryFn: async () => {
      debug("fetches control", { platform, controlId });
      const control = await playbookApi.getControl(platform as AutomationPlatform, controlId as string);
      debug("fetched control", { platform, controlId });
      return control;
    },
    enabled: !!platform && !!controlId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Fetches a control's playbook source. */
export function useControlSource(
  platform: AutomationPlatform | undefined,
  controlId: string | undefined,
) {
  return useQuery({
    queryKey: automationKeys.controlSource(platform, controlId),
    queryFn: async () => {
      debug("fetches control source", { platform, controlId });
      const source = await playbookApi.getControlSource(platform as AutomationPlatform, controlId as string);
      debug("fetched control source", { platform, controlId });
      return source;
    },
    enabled: !!platform && !!controlId,
    retry: false,
  });
}

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

/** Sets a control's progress status and refreshes control progress. */
export function useSetControlStatus(ticketId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (input: {
      controlRowId: string;
      status: ControlProgressStatus;
      note?: string;
    }) =>
      controlProgressData.setControlStatus(
        ticketId as string,
        input.controlRowId,
        input.status,
        input.note,
      ),
    onMutate: (input) =>
      debug("sets control status", {
        ticketId,
        controlRowId: input.controlRowId,
        status: input.status,
        hasNote: Boolean(input.note),
      }),
    onError: (error, input) => debug("set control status failed", { ticketId, controlRowId: input.controlRowId, error }),
    onSuccess: () => invalidate(controlProgressInvalidationKeys(ticketId as string)),
  });
}
