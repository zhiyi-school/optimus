import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationAttachmentFailure,
  useRequestReassessment,
  useSaveConversationAttachment,
  useSendRiskMessage,
} from "@/hooks/queries/conversations";
import { useClassifyRisk } from "@/hooks/queries/tickets";
import {
  conversationAttachmentData,
  createPendingConversationAttachment,
  type PendingConversationAttachment,
} from "@/data/services/conversation-attachments";
import { errorMessage } from "@/lib/utils";
import type { FindingStatus } from "@/data/types";

export type ComposerAction =
  | { kind: "classification"; status: FindingStatus }
  | { kind: "reassessment" };

export type ComposerActionKind = ComposerAction["kind"];

export interface ComposerSubmission {
  message: string;
  file?: File;
  action?: ComposerAction;
}

interface RetryContext {
  pending: PendingConversationAttachment;
  bytesUploaded: boolean;
  action: ComposerAction | undefined;
  message: string;
  error: string;
  retryable: boolean;
}

type SubmissionState =
  | { phase: "idle" }
  | { phase: "recording" }
  | { phase: "attaching"; context: RetryContext }
  | { phase: "attachment_failed"; context: RetryContext }
  | { phase: "complete" };

export class AttachmentError extends Error {}

export function useConversationSubmission(input: {
  conversationId: string | undefined;
  findingId: string | undefined;
  ticketId: string | null | undefined;
}) {
  const sendMessage = useSendRiskMessage(input.conversationId);
  const classify = useClassifyRisk(input.findingId, input.conversationId);
  const request = useRequestReassessment(input.conversationId);
  const saveAttachment = useSaveConversationAttachment();
  const [state, setState] = useState<SubmissionState>({ phase: "idle" });
  const [failure, setFailure] = useState<unknown>(null);
  const latestState = useRef(state);
  const scope = useRef(0);
  const inFlight = useRef(false);
  latestState.current = state;

  const abandonAttachment = useCallback(async () => {
    const current = latestState.current;
    scope.current += 1;
    setState({ phase: "idle" });
    setFailure(null);
    if (current.phase === "attachment_failed" && current.context.bytesUploaded) {
      try {
        await conversationAttachmentData.discardUnused(current.context.pending);
      } catch {
        // Abandoning the retry must not turn storage cleanup into another user task.
      }
    }
  }, []);

  useEffect(() => {
    const generation = scope.current + 1;
    scope.current = generation;
    setState({ phase: "idle" });
    setFailure(null);
    return () => {
      if (scope.current !== generation) return;
      scope.current += 1;
      const current = latestState.current;
      if (current.phase === "attachment_failed" && current.context.bytesUploaded) {
        void conversationAttachmentData.discardUnused(current.context.pending).catch(() => undefined);
      }
    };
  }, [input.conversationId]);

  async function attach(context: RetryContext, generation: number) {
    setState({ phase: "attaching", context });
    try {
      await saveAttachment.mutateAsync({
        pending: context.pending,
        bytesUploaded: context.bytesUploaded,
      });
      if (scope.current === generation) {
        setFailure(null);
        setState({ phase: "complete" });
      }
    } catch (error) {
      const attachmentFailure = error as ConversationAttachmentFailure;
      const next = {
        ...context,
        pending: attachmentFailure.pending ?? context.pending,
        bytesUploaded: attachmentFailure.bytesUploaded ?? context.bytesUploaded,
        error: errorMessage(
          attachmentFailure.cause ?? error,
          "That was recorded, but the file could not be attached. Send again to retry the file only.",
        ),
      };
      if (scope.current === generation) {
        setState({ phase: "attachment_failed", context: next });
        setFailure(new AttachmentError(next.error));
      } else if (next.bytesUploaded) {
        void conversationAttachmentData.discardUnused(next.pending).catch(() => undefined);
      }
      throw new AttachmentError(next.error);
    }
  }

  async function submitOnce(submission: ComposerSubmission) {
    const generation = scope.current;
    const current = latestState.current;
    if (current.phase === "attachment_failed") {
      if (!current.context.retryable) throw new AttachmentError(current.context.error);
      return attach(current.context, generation);
    }

    setFailure(null);
    setState({ phase: "recording" });
    sendMessage.reset();
    classify.reset();
    request.reset();
    try {
      let entryId: string | null;
      if (submission.action?.kind === "classification") {
        const result = await classify.mutateAsync({
          status: submission.action.status,
          reason: submission.message,
        });
        entryId = result.entryId;
      } else if (submission.action?.kind === "reassessment") {
        const result = await request.mutateAsync({
          findingId: input.findingId as string,
          ticketId: input.ticketId ?? null,
          message: submission.message,
        });
        entryId = result.entryId;
      } else {
        const entry = await sendMessage.mutateAsync({ message: submission.message });
        entryId = entry.id;
      }

      if (scope.current !== generation) return;
      if (!submission.file) {
        setState({ phase: "complete" });
        return;
      }
      if (!entryId) {
        const context: RetryContext = {
          pending: createPendingConversationAttachment(
            input.conversationId as string,
            "legacy-classification-without-entry",
            submission.file,
          ),
          bytesUploaded: false,
          action: submission.action,
          message: submission.message,
          retryable: false,
          error:
            "The classification was recorded, but this database cannot attach a file to it yet. Apply migration 0025 and attach the file as a message.",
        };
        setState({ phase: "attachment_failed", context });
        const error = new AttachmentError(context.error);
        setFailure(error);
        throw error;
      }

      const context: RetryContext = {
        pending: createPendingConversationAttachment(
          input.conversationId as string,
          entryId,
          submission.file,
        ),
        bytesUploaded: false,
        action: submission.action,
        message: submission.message,
        retryable: true,
        error: "",
      };
      return attach(context, generation);
    } catch (error) {
      if (!(error instanceof AttachmentError) && scope.current === generation) {
        setState({ phase: "idle" });
        setFailure(error);
      }
      throw error;
    }
  }

  async function submit(submission: ComposerSubmission) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      return await submitOnce(submission);
    } finally {
      inFlight.current = false;
    }
  }

  const retry = state.phase === "attachment_failed" ? state.context : null;
  return {
    submit,
    abandonAttachment,
    phase: state.phase,
    pending: state.phase === "recording" || state.phase === "attaching",
    error: failure ?? sendMessage.error ?? classify.error ?? request.error ?? saveAttachment.error,
    attachmentRetry: retry
      ? {
          entryId: retry.pending.entryId,
          fileName: retry.pending.file.name,
          retryable: retry.retryable,
          message: retry.error,
        }
      : null,
  };
}
