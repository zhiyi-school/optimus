import { useConversationSubmission } from "@/hooks/conversation-submission";
import type {
  Application,
  Finding,
  FindingStatus,
  RetestRun,
  RiskConversation,
  Ticket,
} from "@/data/types";
import type { Capability } from "@/auth/permissions";

export const CLASSIFICATION_OPTIONS: { value: FindingStatus; label: string }[] = [
  { value: "at_risk", label: "At Risk" },
  { value: "reduced_risk", label: "Reduced Risk" },
  { value: "inconclusive", label: "Inconclusive" },
];

export { AttachmentError } from "@/hooks/conversation-submission";
export type {
  ComposerAction,
  ComposerActionKind,
  ComposerSubmission,
} from "@/hooks/conversation-submission";

/** What the composer may offer this reader, and why an offer cannot be used. */
export type ComposerActionOffer =
  | {
      kind: "classification";
      blockedReason?: string | null;
      currentStatus?: FindingStatus | null;
    }
  | { kind: "reassessment"; blockedReason?: string | null };

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

/** One submit for every action: the file lands on the entry that action created. */
export function useRiskComposer({
  conversation,
  finding,
  ticket,
  can,
}: Omit<RiskConversationContext, "application" | "profileId" | "retests">) {
  const conversationId = conversation?.id;
  const submission = useConversationSubmission({
    conversationId,
    findingId: finding?.id,
    ticketId: ticket?.id,
  });

  const mayRequest = can("request_retest");
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

  if (mayRequest) {
    offers.push({
      kind: "reassessment",
      blockedReason:
        !conversation || !finding
          ? "No result has been published for this risk yet, so there is nothing to reassess."
          : null,
    });
  }

  return {
    offers,
    ...submission,
  };
}
