/**
 * Query key groups invalidated together after sync, conversation and ticket changes.
 */

import {
  assessmentKeys,
  automationKeys,
  conversationKeys,
  evidenceKeys,
  ticketKeys,
} from "@/hooks/queries/keys";

export const dashboardSyncInvalidationPrefixes = [
  evidenceKeys.findings(),
  evidenceKeys.findingPrefix(),
  ticketKeys.findingRetestsPrefix(),
  assessmentKeys.detailPrefix(),
  assessmentKeys.all(),
  assessmentKeys.runRequestPrefix(),
  ticketKeys.listPrefix(),
  ticketKeys.detailPrefix(),
  ticketKeys.withRelations(),
  ticketKeys.metrics(),
  conversationKeys.byRiskPrefix(),
  conversationKeys.entriesPrefix(),
  automationKeys.testHistoryPrefix(),
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

/** Keys to refresh after a ticket lifecycle change, plus the linked finding. */
export function ticketLifecycleInvalidationKeys(
  ticketId: string,
  findingId: string | null | undefined,
) {
  return [
    ticketKeys.detail(ticketId),
    ticketKeys.withRelations(),
    ticketKeys.listPrefix(),
    conversationKeys.entriesPrefix(),
    ticketKeys.metrics(),
    ...(findingId ? [evidenceKeys.finding(findingId)] : []),
  ] as const;
}

/** Keys to refresh after a ticket's control or step progress changes. */
export function controlProgressInvalidationKeys(ticketId: string) {
  return [
    ticketKeys.controls(ticketId),
    ticketKeys.controlSteps(ticketId),
    ticketKeys.controlsBulk(),
  ] as const;
}
