/**
 * Query and mutation hooks for risk acceptance: the acceptance in force, accepting, retracting, and review decisions.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { riskAcceptanceData } from "@/database/risk-acceptance";
import type { RiskAcceptanceDecision } from "@/database/types";
import { useInvalidateQueries } from "./invalidation";
import { riskAcceptanceInvalidationKeys } from "@/hooks/queries/invalidation-rules";
import { riskAcceptanceKeys, ticketKeys } from "@/hooks/queries/keys";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:risk-acceptance");

/** Fetches the acceptance in force for a finding, or null when the risk is not accepted. */
export function useActiveRiskAcceptance(findingId: string | undefined) {
  return useQuery({
    queryKey: riskAcceptanceKeys.activeForFinding(findingId),
    queryFn: async () => {
      debug("fetches active risk acceptance", { findingId });
      const row = await riskAcceptanceData.getActiveForFinding(findingId as string);
      debug("fetched active risk acceptance", { findingId, acceptanceId: row?.id ?? null });
      return row;
    },
    enabled: !!findingId,
  });
}

/** Accepts a risk from its conversation and refreshes the conversation, acceptance, reassessment and ticket keys. */
export function useAcceptRisk(conversationId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (input: { findingId: string; reason: string; submissionId: string }) =>
      riskAcceptanceData.accept({ conversationId: conversationId as string, ...input }),
    onMutate: (input) =>
      debug("accepts risk", { conversationId, findingId: input.findingId, submissionId: input.submissionId }),
    onError: (error, input) =>
      debug("accept risk failed", { conversationId, submissionId: input.submissionId, error }),
    onSuccess: (_data, variables) =>
      invalidate(riskAcceptanceInvalidationKeys(conversationId as string, variables.findingId)),
  });
}

/** Retracts a risk acceptance and refreshes the conversation, acceptance and ticket keys. */
export function useRetractRiskAcceptance(conversationId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (input: { acceptanceId: string; findingId: string; reason: string }) =>
      riskAcceptanceData.retract({ acceptanceId: input.acceptanceId, reason: input.reason }),
    onMutate: (input) => debug("retracts risk acceptance", { conversationId, acceptanceId: input.acceptanceId }),
    onError: (error, input) =>
      debug("retract risk acceptance failed", { conversationId, acceptanceId: input.acceptanceId, error }),
    onSuccess: (_data, variables) =>
      invalidate(riskAcceptanceInvalidationKeys(conversationId as string, variables.findingId)),
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
        ticketKeys.withRelations(),
        ticketKeys.byFinding(variables.finding_id),
        ticketKeys.metrics(),
      ]),
  });
}

/** Records a risk acceptance decision and refreshes the ticket, ticket lists and metrics. */
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
        ticketKeys.detail(variables.ticketId),
        ticketKeys.withRelations(),
        ticketKeys.metrics(),
      ]),
  });
}
