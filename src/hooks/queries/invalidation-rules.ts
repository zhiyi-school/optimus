/**
 * Query key groups invalidated together after sync, conversation and ticket changes.
 */

import { conversationKeys, evidenceKeys, ticketKeys } from "@/hooks/query-keys";

export const dashboardSyncInvalidationPrefixes = [
  ["findings"],
  ["finding"],
  ["findingHistory"],
  ["findingRetests"],
  ["assessment"],
  ["assessments"],
  ["assessmentRunRequest"],
  ["tickets"],
  ["ticket"],
  ["ticketsWithRelations"],
  ["ticketRetests"],
  ["activity"],
  ["dashboardMetrics"],
  ["riskConversation"],
  ["riskConversationEntries"],
  ["testRunHistory"],
] as const;

/** Keys to refresh after a conversation changes: its entries and all attachments. */
export function conversationInvalidationKeys(conversationId: string) {
  return [conversationKeys.entries(conversationId), conversationKeys.attachments()] as const;
}

/** Keys to refresh after a conversation entry is recorded. */
export function conversationEntryInvalidationKeys(conversationId: string) {
  return [conversationKeys.entries(conversationId)] as const;
}

/** Keys to refresh after conversation attachments are uploaded. */
export function conversationAttachmentInvalidationKeys() {
  return [conversationKeys.attachments()] as const;
}

/** Keys to refresh after a ticket lifecycle change, plus the linked finding's evidence and activity. */
export function ticketLifecycleInvalidationKeys(
  ticketId: string,
  findingId: string | null | undefined,
) {
  return [
    ticketKeys.detail(ticketId),
    ticketKeys.withRelations(),
    ticketKeys.listPrefix(),
    ticketKeys.activity("ticket", ticketId),
    conversationKeys.entriesPrefix(),
    ticketKeys.metrics(),
    ...(findingId
      ? [evidenceKeys.finding(findingId), ticketKeys.activity("finding", findingId)]
      : []),
  ] as const;
}

/** Keys to refresh after a ticket's control or step progress changes. */
export function controlProgressInvalidationKeys(ticketId: string) {
  return [
    ticketKeys.controls(ticketId),
    ticketKeys.controlSteps(ticketId),
    ticketKeys.controlsBulk(),
    ticketKeys.activity("ticket", ticketId),
  ] as const;
}
