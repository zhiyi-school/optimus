/**
 * The entries of a risk conversation feed: messages, workflow events and automated test runs.
 */

import { forwardRef } from "react";
import { ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/shared/badges-and-table";
import { ToneBadge } from "@/components/shared/progress-display";
import { EvidenceViewer, type EvidenceItem } from "@/components/evidence/evidence";
import { AttachmentList } from "@/components/conversation/attachments";
import { initialsOf, roleBubbleTone, roleLabel } from "@/lib/people";
import { primaryRole } from "@/auth/permissions";
import {
  conversationEventConfig,
  conversationEventSummary,
  mapVerdictToFindingStatus,
  type ConversationEventKind,
} from "@/domain/status-labels";
import { cn, formatDate, formatDuration } from "@/lib/utils";
import type { AutomationResultRow } from "@/automation-api/types";
import type { Profile, RiskConversationAttachment, RiskConversationEntry } from "@/database/types";

/** Chat bubble for a message entry with author, role, time and attachments. */
export function MessageEntry({
  entry,
  attachments,
  author,
  isMe,
}: {
  entry: RiskConversationEntry;
  attachments: RiskConversationAttachment[];
  author: Profile | undefined;
  isMe: boolean;
}) {
  const authorRole = primaryRole(author?.roles);
  const tone = authorRole ? roleBubbleTone[authorRole] : "bg-muted";
  return (
    <li className="flex gap-3">
      <Avatar className={tone}>
        <AvatarFallback>
          {author ? initialsOf(author.display_name || author.email) : "?"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">
            {isMe ? "You" : (author?.display_name ?? "Team member")}
          </span>
          {authorRole && (
            <span className="text-xs text-muted-foreground">({roleLabel[authorRole]})</span>
          )}
          <span className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{entry.message}</p>
        <AttachmentList attachments={attachments} />
      </div>
    </li>
  );
}

/** Dashed card for a workflow event entry with its summary, author and attachments. */
export function EventEntry({
  entry,
  attachments,
  author,
}: {
  entry: RiskConversationEntry;
  attachments: RiskConversationAttachment[];
  author: Profile | undefined;
}) {
  const kind = entry.kind as ConversationEventKind;
  const presentation = conversationEventConfig[kind];
  return (
    <li className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-card">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-dashed border-border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={presentation.tone} label={presentation.label} />
          <span className="text-sm text-foreground">
            {conversationEventSummary(kind, entry.metadata)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {author?.display_name ?? "Automation"} · {formatDate(entry.created_at)}
        </p>
        {entry.message && (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
            {entry.message}
          </p>
        )}
        <AttachmentList attachments={attachments} />
      </div>
    </li>
  );
}

/** Automated test run entry with verdict, run details and evidence; outlined when highlighted. */
export const TestRunEntry = forwardRef<
  HTMLLIElement,
  {
    run: AutomationResultRow;
    evidenceUrl?: (runTimestamp: string, ref: string) => string;
    highlighted: boolean;
  }
>(function TestRunEntry({ run, evidenceUrl, highlighted }, ref) {
  return (
    <li
      ref={ref}
      className={cn(
        "flex gap-3 rounded-lg transition-colors",
        highlighted && "p-2 ring-2 ring-primary/40",
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <ShieldCheck className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">Automated test</span>
          <span className="text-xs text-muted-foreground">{formatDate(run.started_at)}</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={mapVerdictToFindingStatus(run.verdict)} />
            <span className="text-xs text-muted-foreground">
              {run.status} · {formatDuration(run.duration_seconds)} · run {run.run_timestamp}
            </span>
          </div>
          <p className="break-words text-sm text-foreground">{run.summary}</p>
          {run.evidence.length > 0 && evidenceUrl && (
            <div className="mt-3">
              <EvidenceViewer
                items={run.evidence.map(
                  (item, index): EvidenceItem => ({
                    id: `${run.run_timestamp}-${index}`,
                    name: item.label,
                    kind: item.kind,
                    url: evidenceUrl(run.run_timestamp, item.ref),
                    downloadName: item.path.split("/").pop() || item.path,
                    sizeBytes: item.size_bytes,
                    source: "Automation backend",
                  }),
                )}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
});
