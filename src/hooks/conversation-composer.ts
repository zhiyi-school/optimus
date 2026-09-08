import { useMemo, useState } from "react";
import {
  useClassifyRisk,
  useRequestReassessment,
  useRiskControls,
  useSendRiskMessage,
  useTicketControlSteps,
  useTicketControls,
} from "@/hooks/queries";
import { riskConversationData } from "@/data/services";
import {
  activeReassessment,
  effectiveSelectedControlId,
  isReconciled,
  liveControls,
  reassessmentBlockedReason,
  selectableControls,
  selectedControl,
  selectedControlReconciliationPlan,
  selectionWasReplaced,
} from "@/lib/resolve";
import { errorMessage } from "@/lib/utils";
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

/** An optional workflow action carried by an otherwise ordinary message. */
export type ComposerAction =
  | { kind: "classification"; status: FindingStatus }
  | { kind: "reassessment" };

export type ComposerActionKind = ComposerAction["kind"];

export interface ComposerSubmission {
  message: string;
  file?: File;
  action?: ComposerAction;
}

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

/** The entry an action already created, kept so a failed upload is retried alone. */
interface AttachmentRetry {
  entryId: string;
  fileName: string;
}

export class AttachmentError extends Error {}

/**
 * Whether the remediation's selected approach is finished, using the same rows
 * the remediation section shows. The queries are shared with that section, so a
 * risk page asks for nothing extra.
 */
function useReassessmentReadiness(
  ticket: Ticket | null | undefined,
  finding: Finding | null | undefined,
  retests: RetestRun[] | undefined,
  mayRequest: boolean,
) {
  const definitions = useRiskControls(finding?.platform, finding?.test_id);
  const controls = useTicketControls(ticket?.id);
  const steps = useTicketControlSteps(ticket?.id);

  return useMemo(() => {
    const candidates = selectableControls(definitions.data);
    const stored = ticket?.selected_control_id ?? null;
    const chosen = selectedControl(candidates, effectiveSelectedControlId(stored, candidates));
    const live = chosen ? liveControls([chosen], controls.data ?? [], steps.data ?? []) : [];

    return reassessmentBlockedReason({
      ticket,
      loading: definitions.isLoading || controls.isLoading || steps.isLoading,
      failed: definitions.isError,
      replaced: selectionWasReplaced(stored, candidates),
      reconciled: isReconciled(
        selectedControlReconciliationPlan(chosen),
        controls.data ?? [],
        steps.data ?? [],
      ),
      control: live[0],
      activeRetest: activeReassessment(retests),
      mayRequest,
    });
  }, [ticket, definitions, controls, steps, retests, mayRequest]);
}

/** One submit for every action: the file lands on the entry that action created. */
export function useRiskComposer({
  conversation,
  finding,
  ticket,
  retests,
  can,
}: Omit<RiskConversationContext, "application" | "profileId">) {
  const conversationId = conversation?.id;
  const sendMessage = useSendRiskMessage(conversationId);
  const classify = useClassifyRisk(finding?.id, conversationId);
  const request = useRequestReassessment(conversationId);
  const [retry, setRetry] = useState<AttachmentRetry | null>(null);

  const mayRequest = can("request_retest");
  const reassessmentBlocked = useReassessmentReadiness(ticket, finding, retests, mayRequest);
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
          : reassessmentBlocked,
    });
  }

  async function attach(entryId: string, file: File) {
    try {
      await riskConversationData.uploadAttachment(conversationId as string, entryId, file);
      setRetry(null);
    } catch (error) {
      setRetry({ entryId, fileName: file.name });
      throw new AttachmentError(
        errorMessage(
          error,
          "That was recorded, but the file could not be attached. Send again to retry the file only.",
        ),
      );
    }
  }

  async function submit(submission: ComposerSubmission) {
    const { message, file, action } = submission;

    // The workflow already landed last time; only the file is outstanding.
    if (retry && file && retry.fileName === file.name) {
      return attach(retry.entryId, file);
    }

    if (action?.kind === "classification") {
      const { entryId } = await classify.mutateAsync({ status: action.status, reason: message });
      if (file && !entryId) {
        throw new AttachmentError(
          "The classification was recorded, but this database cannot attach a file to it yet. Apply migration 0025 and attach the file as a message.",
        );
      }
      if (file && entryId) await attach(entryId, file);
      return;
    }

    if (action?.kind === "reassessment") {
      const { entryId } = await request.mutateAsync({
        findingId: finding?.id as string,
        ticketId: ticket?.id ?? null,
        message,
      });
      if (file) await attach(entryId, file);
      return;
    }

    await sendMessage.mutateAsync({ message, file });
    setRetry(null);
  }

  return {
    offers,
    submit,
    pending: sendMessage.isPending || classify.isPending || request.isPending,
    error: sendMessage.error ?? classify.error ?? request.error,
    /** Set when only the attachment still has to be retried. */
    attachmentRetry: retry,
  };
}
