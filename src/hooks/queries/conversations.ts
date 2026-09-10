import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { riskConversationData } from "@/data/services/conversations";
import {
  conversationAttachmentData,
  type PendingConversationAttachment,
} from "@/data/services/conversation-attachments";
import { retestData } from "@/data/services/tickets";
import type { RiskConversationAttachment, RiskConversationEntry } from "@/data/types";
import { useInvalidateQueries } from "./invalidation";
import {
  conversationAttachmentInvalidationKeys,
  conversationEntryInvalidationKeys,
  conversationInvalidationKeys,
} from "./invalidation-rules";
import { conversationKeys, ticketKeys } from "@/hooks/query-keys";

const EMPTY_ENTRIES: RiskConversationEntry[] = [];
const EMPTY_ATTACHMENTS: RiskConversationAttachment[] = [];

/**
 * The conversation is keyed by application and risk, so opening the same risk
 * from a different assessment of the same application resolves to the same
 * thread. `create` is the caller's permission to open it: a read-only viewer
 * only looks one up, so no conversation is created on their behalf.
 */
export function useRiskConversation(
  applicationId: string | undefined,
  riskId: string | undefined,
  findingId: string | null | undefined,
  opts: { create: boolean; originAssessmentId?: string | null },
) {
  return useQuery({
    queryKey: conversationKeys.byRisk(applicationId, riskId, findingId, opts.create),
    queryFn: () =>
      opts.create
        ? riskConversationData.getOrCreate({
            applicationId: applicationId as string,
            riskId: riskId as string,
            findingId,
            originAssessmentId: opts.originAssessmentId,
          })
        : riskConversationData.find(applicationId as string, riskId as string),
    enabled: !!applicationId && !!riskId,
  });
}

export function useRiskConversationById(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: conversationKeys.detail(conversationId),
    queryFn: () => riskConversationData.get(conversationId as string),
    enabled: !!conversationId,
  });
}

/** One subscription per open conversation; an insert refetches the keyed list, so nothing doubles up. */
export function useRiskConversationEntries(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: conversationKeys.entries(conversationId),
    queryFn: () => riskConversationData.listEntries(conversationId as string),
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (!conversationId) return;
    return riskConversationData.subscribeToConversation(conversationId, () => {
      void queryClient.invalidateQueries({
        queryKey: conversationKeys.entries(conversationId),
      });
    });
  }, [conversationId, queryClient]);

  return { ...query, data: query.data ?? (query.isLoading ? undefined : EMPTY_ENTRIES) };
}

/** The query itself, so a failure to load files is distinguishable from having none. */
export function useRiskConversationAttachments(entryIds: string[]) {
  const key = [...entryIds].sort();
  const query = useQuery({
    queryKey: conversationKeys.attachments(key),
    queryFn: () => riskConversationData.listAttachments(key),
    enabled: key.length > 0,
  });
  return { ...query, data: query.data ?? EMPTY_ATTACHMENTS };
}

export function useSendRiskMessage(conversationId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (input: { message: string }) =>
      riskConversationData.addEntry({
        conversation_id: conversationId as string,
        kind: "message",
        message: input.message,
      }),
    onSuccess: () => invalidate(conversationEntryInvalidationKeys(conversationId as string)),
  });
}

export class ConversationAttachmentFailure extends Error {
  constructor(
    message: string,
    readonly pending: PendingConversationAttachment,
    readonly bytesUploaded: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function useSaveConversationAttachment() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: async (input: {
      pending: PendingConversationAttachment;
      bytesUploaded: boolean;
    }) => {
      let bytesUploaded = input.bytesUploaded;
      try {
        if (!bytesUploaded) {
          await conversationAttachmentData.uploadBytes(input.pending);
          bytesUploaded = true;
        }
        const attachment = await conversationAttachmentData.saveMetadata(input.pending);
        return { attachment, bytesUploaded };
      } catch (error) {
        throw new ConversationAttachmentFailure(
          "That was recorded, but the file could not be attached.",
          input.pending,
          bytesUploaded,
          { cause: error },
        );
      }
    },
    onSuccess: () => invalidate(conversationAttachmentInvalidationKeys()),
  });
}

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
    onSuccess: (_data, variables) =>
      invalidate([
        ...conversationInvalidationKeys(conversationId as string),
        ticketKeys.findingRetests(variables.findingId),
        ticketKeys.withRelations(),
        ticketKeys.listPrefix(),
        ["assessment"],
        ["assessments"],
        ticketKeys.metrics(),
        ...(variables.ticketId
          ? [
              ticketKeys.detail(variables.ticketId),
              ["ticketRetests", variables.ticketId],
              ticketKeys.activity("ticket", variables.ticketId),
            ]
          : []),
      ]),
  });
}

export function useWithdrawReassessment(conversationId: string | undefined) {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: (input: { retestId: string; reason: string; findingId: string; ticketId: string }) =>
      retestData.withdraw(input.retestId, input.reason),
    onSuccess: (_data, variables) =>
      invalidate([
        ...conversationInvalidationKeys(conversationId as string),
        ticketKeys.findingRetests(variables.findingId),
        ticketKeys.withRelations(),
        ticketKeys.listPrefix(),
        ticketKeys.metrics(),
        ticketKeys.detail(variables.ticketId),
        ["ticketRetests", variables.ticketId],
        ticketKeys.activity("ticket", variables.ticketId),
      ]),
  });
}
