import { formatDate } from "@/lib/utils";
import { EmptyState } from "@/components/common";
import type { ActivityLogEntry } from "@/data/types";

const actionLabels: Record<string, string> = {
  assessment_created: "Assessment created",
  finding_created: "Finding created",
  finding_status_changed: "Finding status changed",
  ticket_created: "Ticket created",
  ticket_updated: "Ticket updated",
  message_added: "Message added",
  evidence_added: "Evidence added",
  fix_submitted: "Fix submitted",
  retest_requested: "Retest requested",
  retest_started: "Retest started",
  retest_completed: "Retest completed",
  risk_acceptance_requested: "Risk acceptance requested",
  risk_acceptance_accepted: "Risk acceptance accepted",
  risk_acceptance_rejected: "Risk acceptance rejected",
};

function describe(entry: ActivityLogEntry): string {
  const label = actionLabels[entry.action] ?? entry.action;
  if (entry.action === "finding_status_changed" && entry.metadata) {
    const prev = entry.metadata["previous_status"];
    const next = entry.metadata["new_status"];
    if (prev && next) return `${label}: ${prev} → ${next}`;
  }
  return label;
}

export function Timeline({ entries }: { entries: ActivityLogEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState title="No activity recorded yet." />;
  }

  return (
    <ol className="relative ml-2 space-y-4 border-l border-border pl-4">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
          <p className="text-sm text-foreground">{describe(entry)}</p>
          <p className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</p>
        </li>
      ))}
    </ol>
  );
}
