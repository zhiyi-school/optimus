/**
 * Mutation hooks for risk acceptance tickets and their review decisions.
 */

import { useMutation } from "@tanstack/react-query";
import { riskAcceptanceData } from "@/data/services/risk-acceptance";
import type { RiskAcceptanceDecision } from "@/data/types";
import { useInvalidateQueries } from "./invalidation";
import { ticketKeys } from "@/hooks/query-keys";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:risk-acceptance");

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
