/**
 * Risk conversation composer hook, classification options and action offers.
 */

import { useConversationSubmission } from "@/hooks/conversation/submission";
import { useActiveRiskAcceptance } from "@/hooks/queries/risk-acceptance";
import type {
  Application,
  Finding,
  FindingStatus,
  RetestRun,
  RiskConversation,
  Ticket,
} from "@/database/types";
import type { Capability } from "@/auth/permissions";

export const CLASSIFICATION_OPTIONS: { value: FindingStatus; label: string }[] = [
  { value: "at_risk", label: "At Risk" },
  { value: "reduced_risk", label: "Reduced Risk" },
  { value: "inconclusive", label: "Inconclusive" },
];

export { AttachmentError } from "@/hooks/conversation/submission";
export type {
  ComposerAction,
  ComposerActionKind,
  ComposerSubmission,
} from "@/hooks/conversation/submission";

/** What the composer may offer this reader, and why an offer cannot be used. */
export type ComposerActionOffer =
  | {
      kind: "classification";
      blockedReason?: string | null;
      currentStatus?: FindingStatus | null;
    }
  | { kind: "reassessment"; blockedReason?: string | null }
  | { kind: "acceptance"; blockedReason?: string | null }
  | { kind: "retraction"; blockedReason?: string | null };

export interface RiskConversationContext {
  conversation: RiskConversation | null | undefined;
  finding: Finding | null | undefined;
  application: Application | null | undefined;
  ticket: Ticket | null | undefined;
  retests: RetestRun[] | undefined;
  can: (capability: Capability) => boolean;
  /** Withdrawal is the requester's own action, so the viewer's identity decides it. */
  profileId: string | undefined;
}

/** Returns the reader's classification, reassessment and acceptance offers plus the shared record-then-attach submission. */
export function useRiskComposer({
  conversation,
  finding,
  ticket,
  can,
}: Omit<RiskConversationContext, "application" | "profileId" | "retests">) {
  const conversationId = conversation?.id;
  const acceptance = useActiveRiskAcceptance(finding?.id);
  const accepted = acceptance.data ?? null;
  const submission = useConversationSubmission({
    conversationId,
    findingId: finding?.id,
    ticketId: ticket?.id,
    acceptanceId: accepted?.id,
  });

  const mayRequest = can("request_retest");
  const mayAccept = can("accept_risk");
  const offers: ComposerActionOffer[] = [];

  if (can("update_finding")) {
    offers.push({
      kind: "classification",
      currentStatus: finding?.status,
      blockedReason: !conversation
        ? "This conversation has not loaded, so there is nowhere to record the decision yet."
        : !finding
          ? "No result has been published for this risk yet, so there is no classification to change. Run the test to produce one."
          : null,
    });
  }

  // An accepted risk is not reassessed until the acceptance is retracted.
  if (mayRequest && !accepted) {
    offers.push({
      kind: "reassessment",
      blockedReason:
        !conversation || !finding
          ? "No result has been published for this risk yet, so there is nothing to reassess."
          : null,
    });
  }

  if (mayAccept && accepted) {
    offers.push({
      kind: "retraction",
      blockedReason: !conversation
        ? "This conversation has not loaded, so there is nowhere to record the retraction yet."
        : null,
    });
  } else if (mayAccept) {
    offers.push({
      kind: "acceptance",
      blockedReason:
        !conversation || !finding
          ? "No result has been published for this risk yet, so there is nothing to accept."
          : finding.status === "reduced_risk"
            ? "This risk is already Reduced Risk, so there is nothing to accept."
            : acceptance.isError
              ? "Could not check whether this risk is already accepted. Reload to try again."
              : acceptance.isLoading
                ? "Checking whether this risk is already accepted…"
                : null,
    });
  }

  return {
    offers,
    ...submission,
  };
}
