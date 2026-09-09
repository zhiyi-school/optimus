import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activityData } from "@/data/services/activity";
import { controlProgressData, type ControlReconciliation } from "@/data/services/controls";
import { findingData } from "@/data/services/findings";
import { metricsData } from "@/data/services/metrics";
import { riskConversationData } from "@/data/services/conversations";
import { retestData, riskAcceptanceData, ticketData, type TicketFilters } from "@/data/services/tickets";
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

export function useFindingRetests(findingId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.findingRetests(findingId),
    queryFn: () => retestData.listForFinding(findingId as string),
    enabled: !!findingId,
  });
}

export function useFindingTickets(findingId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.byFinding(findingId),
    queryFn: () => ticketData.list({ findingId }),
    enabled: !!findingId,
  });
}

export function useTicketsByFindingIds(findingIds: string[]) {
  return useQuery({
    queryKey: ticketKeys.byFindingIds(findingIds),
    queryFn: () => ticketData.listByFindingIds(findingIds),
    enabled: findingIds.length > 0,
  });
}

export function useTickets(filters: TicketFilters = {}) {
  return useQuery({
    queryKey: ticketKeys.withRelations(filters),
    queryFn: () => ticketData.listWithRelations(filters),
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: () => ticketData.getWithRelations(id as string),
    enabled: !!id,
  });
}

export function useRiskAcceptance(ticketId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.acceptance(ticketId),
    queryFn: () => riskAcceptanceData.getForTicket(ticketId as string),
    enabled: !!ticketId,
  });
}

export function usePendingRiskAcceptance() {
  return useQuery({
    queryKey: ticketKeys.pendingAcceptance(),
    queryFn: riskAcceptanceData.listPending,
  });
}

export function useActivity(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.activity(entityType, entityId),
    queryFn: () => activityData.listForEntity(entityType, entityId as string),
    enabled: !!entityId,
  });
}

export function useDashboardMetrics() {
  return useQuery({ queryKey: ticketKeys.metrics(), queryFn: metricsData.getOverview });
}

export function useCreateRemediationTicket() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ticketData.createRemediationTicket,
    onSuccess: (_data, variables) =>
      invalidate([
        ["ticketsWithRelations"],
        ["tickets", { findingId: variables.finding_id }],
        ["dashboardMetrics"],
      ]),
  });
}

/**
 * The conversation is resolved here, not on the page: a new remediation reuses
 * the application's existing conversation for that risk, and the ticket records
 * the assessment it was opened against before a later run moves the finding's
 * own assessment reference on.
 */
export function useStartRemediation() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: async (input: {
      ticket: Parameters<typeof ticketData.createRemediationTicket>[0];
      plan: ControlReconciliation[];
      risk?: { applicationId: string; riskId: string; originAssessmentId?: string | null } | null;
    }) => {
      let conversationId: string | null = null;
      if (input.risk) {
        const conversation = await riskConversationData.getOrCreate({
          applicationId: input.risk.applicationId,
          riskId: input.risk.riskId,
          findingId: input.ticket.finding_id,
          originAssessmentId: input.risk.originAssessmentId,
        });
        conversationId = conversation.id;
      }
      const ticket = await ticketData.createRemediationTicket({
        ...input.ticket,
        risk_conversation_id: conversationId,
        origin_assessment_id: input.risk?.originAssessmentId ?? null,
      });
      if (input.plan.length > 0) {
        await controlProgressData.reconcile(ticket.id, input.plan);
      }
      return ticket;
    },
    onSuccess: (ticket) =>
      invalidate([
        ...ticketLifecycleInvalidationKeys(ticket.id, ticket.finding_id),
        ...(ticket.risk_conversation_id
          ? conversationInvalidationKeys(ticket.risk_conversation_id)
          : []),
      ]),
  });
}

export function useWithdrawTicket(ticketId: string, findingId: string | null | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (reason: string) => ticketData.withdraw(ticketId, reason),
    onSuccess: () => invalidate(ticketLifecycleInvalidationKeys(ticketId, findingId)),
  });
}

export function useResumeTicket(ticketId: string, findingId: string | null | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: () => ticketData.resume(ticketId),
    onSuccess: () => invalidate(ticketLifecycleInvalidationKeys(ticketId, findingId)),
  });
}

export function useCreateRiskAcceptanceTicket() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ticketData.createRiskAcceptanceTicket,
    onSuccess: (_data, variables) =>
      invalidate([
        ["ticketsWithRelations"],
        ["tickets", { findingId: variables.finding_id }],
        ["dashboardMetrics"],
      ]),
  });
}

export function useUpdateTicketStatus(ticketId: string) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (status: TicketStatus) => ticketData.updateStatus(ticketId, status),
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


export function useRiskControls(
  platform: AutomationPlatform | undefined,
  riskId: string | null | undefined,
) {
  return useQuery({
    queryKey: automationKeys.riskControls(platform, riskId),
    queryFn: () => playbookApi.listRiskControls(platform as AutomationPlatform, riskId as string),
    enabled: !!platform && !!riskId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useControlDetail(
  platform: AutomationPlatform | undefined,
  controlId: string | undefined,
) {
  return useQuery({
    queryKey: automationKeys.control(platform, controlId),
    queryFn: () => playbookApi.getControl(platform as AutomationPlatform, controlId as string),
    enabled: !!platform && !!controlId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useControlSource(
  platform: AutomationPlatform | undefined,
  controlId: string | undefined,
) {
  return useQuery({
    queryKey: automationKeys.controlSource(platform, controlId),
    queryFn: () => playbookApi.getControlSource(platform as AutomationPlatform, controlId as string),
    enabled: !!platform && !!controlId,
    retry: false,
  });
}

export function useTicketControls(ticketId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.controls(ticketId),
    queryFn: () => controlProgressData.listForTicket(ticketId as string),
    enabled: !!ticketId,
  });
}

export function useTicketControlSteps(ticketId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.controlSteps(ticketId),
    queryFn: () => controlProgressData.listStepsForTicket(ticketId as string),
    enabled: !!ticketId,
  });
}

export function useControlProgressForTickets(ticketIds: string[]) {
  const key = [...ticketIds].sort();
  const controls = useQuery({
    queryKey: ticketKeys.controlsBulk(key),
    queryFn: () => controlProgressData.listForTicketIds(key),
    enabled: key.length > 0,
  });

  const controlRowIds = (controls.data ?? []).map((control) => control.id).sort();
  const steps = useQuery({
    queryKey: ticketKeys.controlStepsBulk(controlRowIds),
    queryFn: () => controlProgressData.listStepsForControlIds(controlRowIds),
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

/** The cached ticket carries the new approach immediately, and is put back if the write is refused. */
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
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (current: unknown) =>
        current ? { ...(current as object), selected_control_id: controlId } : current,
      );
      return { previous };
    },
    onError: (_error, _controlId, context) => {
      if (context) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: () =>
      invalidate([
        ...controlProgressInvalidationKeys(ticketId as string),
        ...ticketLifecycleInvalidationKeys(ticketId as string, findingId),
      ]),
  });
}

export function useReconcileTicketControls(ticketId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (plan: ControlReconciliation[]) =>
      controlProgressData.reconcile(ticketId as string, plan),
    onSuccess: () => invalidate(controlProgressInvalidationKeys(ticketId as string)),
  });
}

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
    onSuccess: () => invalidate(controlProgressInvalidationKeys(ticketId as string)),
  });
}

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
    onSuccess: () => invalidate(controlProgressInvalidationKeys(ticketId as string)),
  });
}
