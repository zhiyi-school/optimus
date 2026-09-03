import type { AutomationResultRow } from "@/api/automation-types";
import type { RiskConversationEntry } from "@/data/types";

export type ConversationTimelineItem =
  | { key: string; at: string; kind: "entry"; entry: RiskConversationEntry }
  | { key: string; at: string; kind: "test_run"; run: AutomationResultRow };

/**
 * What the risk conversation shows, in the order it happened: the entries the
 * database holds, plus the automated runs the backend reports for this
 * application risk. The runs are combined here and never copied into the
 * conversation — the automation host stays their only source.
 */
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

  return items.sort(
    (a, b) =>
      instant(a.at) - instant(b.at) ||
      // A run and the events written about it can share a timestamp, and the
      // run is what caused them.
      rank(a) - rank(b) ||
      sequence(a) - sequence(b) ||
      a.key.localeCompare(b.key),
  );
}

// The two sources format their timestamps independently, so they are compared
// as instants rather than as strings.
function instant(at: string): number {
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function rank(item: ConversationTimelineItem): number {
  return item.kind === "test_run" ? 0 : 1;
}

function sequence(item: ConversationTimelineItem): number {
  return item.kind === "entry" ? item.entry.seq : 0;
}
