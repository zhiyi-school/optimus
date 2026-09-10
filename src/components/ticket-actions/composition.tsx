import { Button } from "@/components/ui/button";
import type { RiskConversationContext } from "@/hooks/conversation-composer";
import { useUpdateTicketStatus } from "@/hooks/queries/tickets";
import {
  canResumeTicket,
  canWithdrawTicket,
  nextReassessment,
  outstandingReassessments,
  runningReassessment,
} from "@/lib/resolve";
import { formatDate } from "@/lib/utils";
import type { Ticket } from "@/data/types";
import type { Capability } from "@/auth/permissions";
import { RequestChangesDialog, ResumeRemediationButton, WithdrawRemediationDialog } from "./remediation";
import { ReviewRiskAcceptanceDialog } from "./acceptance";
import { RunRetestButton } from "./reassessment";

export function RiskConversationActions({
  finding,
  application,
  ticket,
  retests,
  can,
  profileId,
}: RiskConversationContext) {
  const outstanding = outstandingReassessments(retests);
  const running = runningReassessment(retests);
  const next = nextReassessment(retests);
  if (outstanding.length === 0 || !finding) return null;

  const mayRun = can("run_test") && !!application;
  if (!mayRun) return null;

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
      <div className="flex flex-wrap items-center gap-3">
        {next && application ? (
          <RunRetestButton
            key={next.id}
            ticket={ticket}
            finding={finding}
            application={application}
            retestId={next.id}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {running
              ? "A reassessment for this risk is already running. The next request can be started once it finishes."
              : "No reassessment is waiting to be started."}
          </p>
        )}
        {outstanding.length > 1 && (
          <span className="text-xs text-muted-foreground">
            {outstanding.length} requests outstanding — security runs them one at a time.
          </span>
        )}
      </div>
    </div>
  );
}

export function TicketActions({
  ticket,
  can,
  riskAcceptanceId,
}: {
  ticket: Ticket;
  can: (capability: Capability) => boolean;
  riskAcceptanceId?: string;
}) {
  const updateStatus = useUpdateTicketStatus(ticket.id);
  const isDeveloperFlow = ticket.type === "remediation";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {can("withdraw_ticket") && canWithdrawTicket(ticket) && (
        <WithdrawRemediationDialog ticket={ticket} />
      )}

      {can("withdraw_ticket") && canResumeTicket(ticket) && (
        <ResumeRemediationButton ticket={ticket} />
      )}

      {ticket.type === "risk_acceptance" &&
        ticket.status === "under_review" &&
        can("review_risk_acceptance") &&
        riskAcceptanceId && (
          <ReviewRiskAcceptanceDialog ticketId={ticket.id} riskAcceptanceId={riskAcceptanceId} />
        )}

      {isDeveloperFlow &&
        can("request_changes") &&
        ["retest_requested", "under_review"].includes(ticket.status) && (
          <RequestChangesDialog
            ticketId={ticket.id}
            conversationId={ticket.risk_conversation_id}
          />
        )}

      {can("close_ticket") && ticket.status !== "closed" && (
        <Button
          size="sm"
          variant="outline"
          disabled={updateStatus.isPending}
          onClick={() => void updateStatus.mutateAsync("closed")}
        >
          Close Ticket
        </Button>
      )}
    </div>
  );
}
