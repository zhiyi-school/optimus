/**
 * Query and mutation hooks for risk conversations, entries, attachments and reassessment requests.
 */

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { riskConversationData } from "@/database/conversations";
import {
  conversationAttachmentData,
  type PendingConversationAttachment,
} from "@/database/conversation-attachments";
import { retestData } from "@/database/retests";
import type { RiskConversationAttachment, RiskConversationEntry } from "@/database/types";
import { useInvalidateQueries } from "./invalidation";
import {
  conversationAttachmentInvalidationKeys,
  conversationEntryInvalidationKeys,
  conversationInvalidationKeys,
} from "./invalidation-rules";
import { assessmentKeys, conversationKeys, ticketKeys } from "@/hooks/queries/keys";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:conversations");

const EMPTY_ENTRIES: RiskConversationEntry[] = [];
const EMPTY_ATTACHMENTS: RiskConversationAttachment[] = [];

/** Finds the application-and-risk conversation, creating it only when the caller may. */
export function useRiskConversation(
  applicationId: string | undefined,
  riskId: string | undefined,
  findingId: string | null | undefined,
  opts: { create: boolean; originAssessmentId?: string | null },
) {
  return useQuery({
    queryKey: conversationKeys.byRisk(applicationId, riskId, findingId, opts.create),
    queryFn: async () => {
      debug("resolves risk conversation", { applicationId, riskId, findingId, create: opts.create });
      const conversation = await (opts.create
        ? riskConversationData.getOrCreate({
            applicationId: applicationId as string,
            riskId: riskId as string,
            findingId,
            originAssessmentId: opts.originAssessmentId,
          })
        : riskConversationData.find(applicationId as string, riskId as string));
      debug("resolved risk conversation", { applicationId, riskId, conversationId: conversation?.id ?? null });
      return conversation;
    },
    enabled: !!applicationId && !!riskId,
  });
}

/** Fetches a conversation's entries and refetches them on realtime changes, unsubscribing on cleanup. */
export function useRiskConversationEntries(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: conversationKeys.entries(conversationId),
    queryFn: async () => {
      debug("fetches conversation entries", { conversationId });
      const entries = await riskConversationData.listEntries(conversationId as string);
      debug("fetched conversation entries", { conversationId, count: entries.length });
      return entries;
    },
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (!conversationId) return;
    debug("subscribes to conversation", { conversationId });
    const unsubscribe = riskConversationData.subscribeToConversation(conversationId, () => {
      debug("conversation changed, invalidates entries", { conversationId });
      void queryClient.invalidateQueries({
        queryKey: conversationKeys.entries(conversationId),
      });
    });
    return () => {
      debug("unsubscribes from conversation", { conversationId });
      unsubscribe();
    };
  }, [conversationId, queryClient]);

  return { ...query, data: query.data ?? (query.isLoading ? undefined : EMPTY_ENTRIES) };
}

/** Fetches attachments for the given entries, keeping the query state so load failures stay visible. */
export function useRiskConversationAttachments(entryIds: string[]) {
  const key = [...entryIds].sort();
  const query = useQuery({
    queryKey: conversationKeys.attachments(key),
    queryFn: async () => {
      debug("fetches conversation attachments", { entryCount: key.length });
      const attachments = await conversationAttachmentData.listForEntries(key);
      debug("fetched conversation attachments", { entryCount: key.length, count: attachments.length });
      return attachments;
    },
    enabled: key.length > 0,
  });
  return { ...query, data: query.data ?? EMPTY_ATTACHMENTS };
}

/** Records a message entry and refreshes the conversation's entries. */
export function useSendRiskMessage(conversationId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (input: { message: string }) =>
      riskConversationData.addEntry({
        conversation_id: conversationId as string,
        kind: "message",
        message: input.message,
      }),
    onMutate: (input) => debug("sends message", { conversationId, messageLength: input.message.length }),
    onError: (error) => debug("send message failed", { conversationId, error }),
    onSuccess: (entry) => {
      debug("sent message", { conversationId, entryId: entry.id });
      return invalidate(conversationEntryInvalidationKeys(conversationId as string));
    },
  });
}

/** Attachment save error that carries the pending upload and whether its bytes already reached storage. */
export class ConversationAttachmentFailure extends Error {
  /** Stores the pending attachment and upload state so a retry can reuse them. */
  constructor(
    message: string,
    readonly pending: PendingConversationAttachment,
    readonly bytesUploaded: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** Uploads attachment bytes unless already uploaded, then saves metadata, refreshing attachments on success. */
export function useSaveConversationAttachment() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: async (input: {
      pending: PendingConversationAttachment;
      bytesUploaded: boolean;
    }) => {
      let bytesUploaded = input.bytesUploaded;
      const target = { entryId: input.pending.entryId, fileName: input.pending.file.name };
      try {
        if (!bytesUploaded) {
          debug("uploads attachment bytes", { ...target, size: input.pending.file.size });
          await conversationAttachmentData.uploadBytes(input.pending);
          bytesUploaded = true;
          debug("uploaded attachment bytes", target);
        } else {
          debug("reuses uploaded bytes", target);
        }
        const attachment = await conversationAttachmentData.saveMetadata(input.pending);
        debug("saved attachment metadata", { ...target, attachmentId: attachment.id });
        return { attachment, bytesUploaded };
      } catch (error) {
        debug("save attachment failed", { ...target, bytesUploaded, error });
        throw new ConversationAttachmentFailure(
          "That was recorded, but the file could not be attached.",
          input.pending,
          bytesUploaded,
          { cause: error },
        );
      }
    },
    onSuccess: () => {
      debug("attachment saved, invalidates attachments");
      return invalidate(conversationAttachmentInvalidationKeys());
    },
  });
}

/** Requests a reassessment from the conversation and refreshes conversation, retest, ticket and assessment keys. */
export function useRequestReassessment(conversationId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (input: {
      findingId: string;
      ticketId?: string | null;
      message?: string;
      submissionId: string;
    }) =>
      retestData.requestRetest({
        conversationId: conversationId as string,
        findingId: input.findingId,
        ticketId: input.ticketId,
        message: input.message,
        submissionId: input.submissionId,
      }),
    onMutate: (input) =>
      debug("requests reassessment", {
        conversationId,
        findingId: input.findingId,
        ticketId: input.ticketId,
        submissionId: input.submissionId,
        messageLength: input.message?.length ?? 0,
      }),
    onError: (error, input) =>
      debug("request reassessment failed", { conversationId, submissionId: input.submissionId, error }),
    onSuccess: (_data, variables) =>
      invalidate([
        ...conversationInvalidationKeys(conversationId as string),
        ticketKeys.findingRetests(variables.findingId),
        ticketKeys.withRelations(),
        ticketKeys.listPrefix(),
        assessmentKeys.detailPrefix(),
        assessmentKeys.all(),
        ticketKeys.metrics(),
        ...(variables.ticketId ? [ticketKeys.detail(variables.ticketId)] : []),
      ]),
  });
}
