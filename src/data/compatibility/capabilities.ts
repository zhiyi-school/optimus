import type { RiskConversationEntryKind, TicketStatus } from "@/data/types";

export function isHistoricalFixSubmitted(status: TicketStatus | undefined): boolean {
  return status === "fix_submitted";
}

export function isHistoricalFixSubmittedEvent(kind: RiskConversationEntryKind): boolean {
  return kind === "fix_submitted";
}
