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
import { createDebug } from "@/lib/debug";
import { errorMessage } from "@/lib/utils";
import type { FindingStatus } from "@/data/types";

const debug = createDebug("hooks:conversation-submission");

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
  const pendingSubmission = useRef<string | null>(null);
  latestState.current = state;

  const abandonAttachment = useCallback(async () => {
    const current = latestState.current;
    debug("abandons attachment", { phase: current.phase, scope: scope.current + 1 });
    scope.current += 1;
    setState({ phase: "idle" });
    setFailure(null);
    if (current.phase === "attachment_failed" && current.context.bytesUploaded) {
      debug("discards uploaded bytes", { entryId: current.context.pending.entryId });
      try {
        await conversationAttachmentData.discardUnused(current.context.pending);
      } catch (error) {
        debug("discard after abandon failed", { entryId: current.context.pending.entryId, error });
        // Abandoning the retry must not turn storage cleanup into another user task.
      }
    }
  }, []);

  useEffect(() => {
    const generation = scope.current + 1;
    scope.current = generation;
    debug("resets for conversation", { conversationId: input.conversationId, generation });
    setState({ phase: "idle" });
    setFailure(null);
    return () => {
      if (scope.current !== generation) return;
      scope.current += 1;
      const current = latestState.current;
      debug("cleans up conversation scope", { conversationId: input.conversationId, phase: current.phase });
      if (current.phase === "attachment_failed" && current.context.bytesUploaded) {
        void conversationAttachmentData.discardUnused(current.context.pending).catch((error: unknown) => {
          debug("discard on cleanup failed", { entryId: current.context.pending.entryId, error });
        });
      }
    };
  }, [input.conversationId]);

  async function attach(context: RetryContext, generation: number) {
    debug("phase attaching", {
      entryId: context.pending.entryId,
      fileName: context.pending.file.name,
      size: context.pending.file.size,
      bytesUploaded: context.bytesUploaded,
    });
    setState({ phase: "attaching", context });
    try {
      await saveAttachment.mutateAsync({
        pending: context.pending,
        bytesUploaded: context.bytesUploaded,
      });
      debug("attachment saved", { entryId: context.pending.entryId, fileName: context.pending.file.name });
      if (scope.current === generation) {
        setFailure(null);
        setState({ phase: "complete" });
        debug("phase complete", { entryId: context.pending.entryId });
      } else {
        debug("ignores attachment result from stale scope", { generation, scope: scope.current });
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
      debug("attachment failed", {
        entryId: next.pending.entryId,
        fileName: next.pending.file.name,
        bytesUploaded: next.bytesUploaded,
        error: attachmentFailure.cause ?? error,
      });
      if (scope.current === generation) {
        setState({ phase: "attachment_failed", context: next });
        setFailure(new AttachmentError(next.error));
        debug("phase attachment_failed", { entryId: next.pending.entryId, retryable: next.retryable });
      } else if (next.bytesUploaded) {
        debug("discards bytes from stale scope", { entryId: next.pending.entryId });
        void conversationAttachmentData.discardUnused(next.pending).catch((discardError: unknown) => {
          debug("discard from stale scope failed", { entryId: next.pending.entryId, error: discardError });
        });
      }
      throw new AttachmentError(next.error);
    }
  }

  async function submitOnce(submission: ComposerSubmission) {
    const generation = scope.current;
    // Held until the record lands, so a Send retried after a lost response
    // resolves to the request that write already made; cleared afterwards so
    // the next intentional Send is a new request.
    const submissionId = (pendingSubmission.current ??= crypto.randomUUID());
    const current = latestState.current;
    if (current.phase === "attachment_failed") {
      debug("retries attachment on existing entry", {
        entryId: current.context.pending.entryId,
        fileName: current.context.pending.file.name,
        retryable: current.context.retryable,
      });
      if (!current.context.retryable) throw new AttachmentError(current.context.error);
      return attach(current.context, generation);
    }

    debug("phase recording", {
      submissionId,
      action: submission.action?.kind ?? "message",
      messageLength: submission.message.length,
      hasFile: Boolean(submission.file),
    });
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
          submissionId,
        });
        entryId = result.entryId;
      } else {
        const entry = await sendMessage.mutateAsync({ message: submission.message });
        entryId = entry.id;
      }

      pendingSubmission.current = null;
      debug("entry recorded", { submissionId, entryId, action: submission.action?.kind ?? "message" });

      if (scope.current !== generation) {
        debug("ignores recording from stale scope", { generation, scope: scope.current });
        return;
      }
      if (!submission.file) {
        setState({ phase: "complete" });
        debug("phase complete without attachment", { entryId });
        return;
      }
      if (!entryId) {
        debug("cannot attach without entry id", { fileName: submission.file.name });
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
      debug("submission failed", { submissionId, attachmentError: error instanceof AttachmentError, error });
      if (!(error instanceof AttachmentError) && scope.current === generation) {
        setState({ phase: "idle" });
        setFailure(error);
      }
      throw error;
    }
  }

  async function submit(submission: ComposerSubmission) {
    if (inFlight.current) {
      debug("ignores submit while in flight");
      return;
    }
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
