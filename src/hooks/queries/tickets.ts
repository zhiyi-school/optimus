/**
 * Query and mutation hooks for tickets, finding retests, risk classification and dashboard metrics.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { controlProgressData } from "@/database/controls";
import { findingData } from "@/database/findings";
import { metricsData } from "@/database/metrics";
import { riskConversationData } from "@/database/conversations";
import { retestData } from "@/database/retests";
import { ticketData, type TicketFilters } from "@/database/tickets";
import type { ControlReconciliation, FindingStatus } from "@/database/types";
import { useInvalidateQueries } from "./invalidation";
import { conversationInvalidationKeys, ticketLifecycleInvalidationKeys } from "./invalidation-rules";
import { assessmentKeys, evidenceKeys, ticketKeys } from "@/hooks/query-keys";
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

/** Changes a ticket's status and refreshes the ticket, lists and metrics. */

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
        evidenceKeys.finding(findingId),
        evidenceKeys.findings(),
        assessmentKeys.detailPrefix(),
        ticketKeys.withRelations(),
        ticketKeys.listPrefix(),
        ticketKeys.metrics(),
        ...(conversationId ? conversationInvalidationKeys(conversationId) : []),
      ]),
  });
}
