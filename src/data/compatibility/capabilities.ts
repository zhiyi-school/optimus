/**
 * Recognizers for the retired `fix_submitted` state kept on historical tickets and events.
 */

import type { RiskConversationEntryKind, TicketStatus } from "@/data/types";

/** True for a ticket still in the retired `fix_submitted` status. */
export function isHistoricalFixSubmitted(status: TicketStatus | undefined): boolean {
  return status === "fix_submitted";
}

/** True for a conversation entry of the retired `fix_submitted` kind. */
export function isHistoricalFixSubmittedEvent(kind: RiskConversationEntryKind): boolean {
  return kind === "fix_submitted";
}
