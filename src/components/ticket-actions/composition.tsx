/**
 * Lists the outstanding reassessment requests in a risk conversation for testers.
 */

import type { RiskConversationContext } from "@/hooks/conversation-composer";
import { outstandingReassessments } from "@/domain/remediation/reassessments";
import { formatDate } from "@/lib/utils";

/** Lists outstanding reassessment requests for testers, with guidance to run the risk. */
export function RiskConversationActions({
  finding,
  application,
  retests,
  can,
  profileId,
}: RiskConversationContext) {
  const outstanding = outstandingReassessments(retests);
  if (outstanding.length === 0 || !finding) return null;
  if (!can("run_test") || !application) return null;

  return (
    <div className="space-y-2">
      <ol className="space-y-1">
        {outstanding.map((request, index) => (
          <li key={request.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-medium text-foreground">
              {request.status === "running" ? "Running" : `Queued #${index + 1}`}
            </span>
            <span className="text-muted-foreground">
              {request.requested_by === profileId ? "you" : "a teammate"} ·{" "}
              {formatDate(request.created_at)}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {outstanding.length > 1
          ? `${outstanding.length} requests outstanding — run this risk from its test page.`
          : "Run this risk from its test page to answer this request."}
      </p>
    </div>
  );
}

/** Withdraw, resume, review, request-changes and close actions gated by capability and ticket state. */
