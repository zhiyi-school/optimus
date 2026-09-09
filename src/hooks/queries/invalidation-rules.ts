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

export function conversationInvalidationKeys(conversationId: string) {
  return [conversationKeys.entries(conversationId), conversationKeys.attachments()] as const;
}

export function conversationEntryInvalidationKeys(conversationId: string) {
  return [conversationKeys.entries(conversationId)] as const;
}

export function conversationAttachmentInvalidationKeys() {
  return [conversationKeys.attachments()] as const;
}

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

export function controlProgressInvalidationKeys(ticketId: string) {
  return [
    ticketKeys.controls(ticketId),
    ticketKeys.controlSteps(ticketId),
    ticketKeys.controlsBulk(),
    ticketKeys.activity("ticket", ticketId),
  ] as const;
}
