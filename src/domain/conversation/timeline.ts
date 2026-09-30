/**
 * Builds a risk conversation's combined timeline of entries and automated runs.
 */

import type { AutomationResultRow } from "@/automation-api/types";
import type { RiskConversationEntry } from "@/database/types";
import { createDebug } from "@/lib/debug";

const debug = createDebug("lib:conversation-timeline");

export type ConversationTimelineItem =
  | { key: string; at: string; kind: "entry"; entry: RiskConversationEntry }
  | { key: string; at: string; kind: "test_run"; run: AutomationResultRow };

/** Merges stored entries with backend-reported runs in time order; runs are never copied into the conversation. */
export function conversationTimeline(
  entries: RiskConversationEntry[] | undefined,
  runs: AutomationResultRow[] | undefined,
): ConversationTimelineItem[] {
  const items: ConversationTimelineItem[] = [
    ...(entries ?? []).map(
      (entry): ConversationTimelineItem => ({
        key: `entry:${entry.id}`,
        at: entry.created_at,
        kind: "entry",
        entry,
      }),
    ),
    ...(runs ?? []).map(
      (run): ConversationTimelineItem => ({
        key: `run:${run.run_timestamp}`,
        at: run.started_at,
        kind: "test_run",
        run,
      }),
    ),
  ];

  debug("builds timeline", { entryCount: entries?.length ?? 0, runCount: runs?.length ?? 0 });
  return items.sort(
    (a, b) =>
      instant(a.at) - instant(b.at) ||
      // A run sorts before the events it caused when they share a timestamp.
      rank(a) - rank(b) ||
      sequence(a) - sequence(b) ||
      a.key.localeCompare(b.key),
  );
}

/** Parses a timestamp to epoch ms (0 when invalid), as the two sources format timestamps differently. */
function instant(at: string): number {
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Sort rank that puts runs before entries. */
function rank(item: ConversationTimelineItem): number {
  return item.kind === "test_run" ? 0 : 1;
}

/** An entry's sequence number, or 0 for a run. */
function sequence(item: ConversationTimelineItem): number {
  return item.kind === "entry" ? item.entry.seq : 0;
}
