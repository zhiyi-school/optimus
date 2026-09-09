import { Button } from "@/components/ui/button";
import type { RiskConversationContext } from "@/hooks/conversation-composer";
import { useUpdateTicketStatus } from "@/hooks/queries/tickets";
import { activeReassessment, canResumeTicket, canWithdrawReassessment, canWithdrawTicket } from "@/lib/resolve";
import type { Ticket } from "@/data/types";
import type { Capability } from "@/auth/permissions";
import { RequestChangesDialog, ResumeRemediationButton, WithdrawRemediationDialog } from "./remediation";
import { ReviewRiskAcceptanceDialog } from "./acceptance";
import { RunRetestButton, WithdrawReassessmentDialog } from "./reassessment";

export function RiskConversationActions({
  conversation,
  finding,
  application,
  ticket,
  retests,
  can,
  profileId,
}: RiskConversationContext) {
  const pending = activeReassessment(retests);
  if (!pending || !finding) return null;

  const mayWithdraw =
    can("request_retest") &&
    !!conversation &&
    canWithdrawReassessment(pending, ticket, profileId);
  const mayRun = can("run_test") && !!application;
  if (!mayWithdraw && !mayRun) return null;

  return (
    <div className="flex flex-wrap items-start gap-3">
      {mayWithdraw && conversation && (
        <WithdrawReassessmentDialog
          retest={pending}
          conversationId={conversation.id}
          findingId={finding.id}
          ticketId={pending.ticket_id as string}
        />
      )}

      {mayRun && application && (
        <RunRetestButton
          key={pending.id}
          ticket={ticket}
          finding={finding}
          application={application}
          retestId={pending.id}
        />
      )}
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
