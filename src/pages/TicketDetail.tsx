import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { PageHeader, LoadingState, ErrorState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, TicketBadge, PlatformBadge } from "@/components/data-display";
import { Timeline } from "@/components/timeline";
import { TicketActions, WithdrawalNotice } from "@/components/ticket-actions";
import { ConversationPanel } from "@/components/conversation-panel";
import { ControlChecklist } from "@/components/control-checklist";
import { ProgressBar } from "@/components/resolve-display";
import {
  useActivity,
  useProfiles,
  useRiskAcceptance,
  useRiskControls,
  useSendMessage,
  useTicket,
  useTicketAttachments,
  useTicketControlSteps,
  useTicketControls,
  useTicketMessages,
  useTicketRetests,
  useUploadAttachment,
} from "@/hooks/queries";
import { controlProgress, liveControls } from "@/lib/resolve";
import { formatDate as fmt } from "@/lib/utils";
import { ticketTypeConfig as typeConfig } from "@/lib/status";
import type { TicketAttachment } from "@/data/types";
import { ApplicationIcon } from "@/components/application-icon";

export default function TicketDetail() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { profile, can } = useAuth();
  const { data: ticket, isLoading, isError, refetch } = useTicket(ticketId);
  const { data: messages, isLoading: messagesLoading } = useTicketMessages(ticketId);
  const { data: attachments } = useTicketAttachments(ticketId);
  const { data: profiles } = useProfiles();
  const { data: activity } = useActivity("ticket", ticketId);
  const { data: riskAcceptance } = useRiskAcceptance(
    ticket?.type === "risk_acceptance" ? ticketId : undefined,
  );
  const { data: retests } = useTicketRetests(ticketId);
  const { data: controls } = useTicketControls(ticketId);
  const { data: controlSteps } = useTicketControlSteps(ticketId);
  const { data: controlDefinitions } = useRiskControls(
    ticket?.finding?.platform,
    ticket?.finding?.test_id,
  );

  const sendMessage = useSendMessage(ticketId ?? "");
  const uploadAttachment = useUploadAttachment(ticketId ?? "");

  const profileMap = useMemo(
    () => new Map((profiles ?? []).map((p) => [p.id, p])),
    [profiles],
  );
  const attachmentsByMessage = useMemo(() => {
    const map = new Map<string, TicketAttachment[]>();
    for (const a of attachments ?? []) {
      if (!a.message_id) continue;
      const bucket = map.get(a.message_id) ?? [];
      bucket.push(a);
      map.set(a.message_id, bucket);
    }
    return map;
  }, [attachments]);

  if (isLoading) return <LoadingState label="Loading ticket…" />;
  if (isError || !ticket) return <ErrorState message="Unable to load this ticket." onRetry={() => refetch()} />;

  const pendingRetest = (retests ?? []).find((r) => r.status === "queued" || r.status === "running");
  const controlBase = can("view_resolve") ? `/resolve/tickets/${ticket.id}` : `/tickets/${ticket.id}`;
  const live = liveControls(controlDefinitions, controls ?? [], controlSteps ?? []);

  return (
    <div>
      <PageHeader
        title={ticket.title}
        description={`${typeConfig[ticket.type].label}${
          ticket.finding
            ? ` · ${ticket.finding.title}`
            : ticket.application
              ? ` · ${ticket.application.name}`
              : ""
        }`}
        actions={<TicketBadge status={ticket.status} />}
      />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ConversationPanel
            messages={messages}
            isLoading={messagesLoading}
            currentProfileId={profile?.id}
            profileMap={profileMap}
            canComment={can("comment_ticket")}
            onSend={(message) => sendMessage.mutateAsync(message)}
            sending={sendMessage.isPending}
            attachments={attachments}
            attachmentsByMessage={attachmentsByMessage}
            onUploadAttachment={(file) => uploadAttachment.mutateAsync(file)}
          />

          {ticket.type === "remediation" && live.length > 0 && (
            <Card>
              <CardContent className="py-4">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <h2 className="text-sm font-semibold text-foreground">Developer remediation</h2>
                  <div className="min-w-[12rem] flex-1">
                    <ProgressBar
                      label="Control steps completed"
                      progress={controlProgress(live)}
                    />
                  </div>
                </div>
                <ControlChecklist
                  controls={live}
                  linkTo={(controlId) => `${controlBase}/controls/${controlId}`}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="py-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Activity</h2>
              <Timeline entries={activity ?? []} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 py-4">
              <h2 className="text-sm font-semibold text-foreground">Details</h2>
              {ticket.finding && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Finding</p>
                  <Link to={`/findings/${ticket.finding.id}`} className="text-sm font-medium text-primary hover:underline">
                    {ticket.finding.title}
                  </Link>
                  <div className="mt-1">
                    <StatusBadge status={ticket.finding.status} />
                  </div>
                </div>
              )}
              {ticket.application && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Application</p>
                  <p className="flex items-center gap-2 text-sm text-foreground">
                    <ApplicationIcon
                      application={ticket.application}
                      className="h-6 w-6"
                      iconClassName="h-3 w-3"
                    />
                    {ticket.application.name} <PlatformBadge platform={ticket.application.platform} />
                  </p>
                </div>
              )}
              {ticket.target_version && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target Version</p>
                  <p className="text-sm text-foreground">{ticket.target_version}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Updated</p>
                <p className="text-sm text-foreground">{fmt(ticket.updated_at)}</p>
              </div>
              <WithdrawalNotice
                ticket={ticket}
                actorName={
                  ticket.withdrawn_by ? profileMap.get(ticket.withdrawn_by)?.display_name : null
                }
              />
            </CardContent>
          </Card>

          {riskAcceptance && (
            <Card>
              <CardContent className="space-y-2 py-4">
                <h2 className="text-sm font-semibold text-foreground">Risk Acceptance</h2>
                <Detail label="Reason" value={riskAcceptance.reason} />
                <Detail label="Business Justification" value={riskAcceptance.business_justification} />
                <Detail label="Compensating Controls" value={riskAcceptance.compensating_controls} />
                <Detail label="Expires" value={riskAcceptance.expires_at ? fmt(riskAcceptance.expires_at) : undefined} />
                <Detail label="Decision" value={riskAcceptance.decision ?? "pending"} />
                {riskAcceptance.review_comment && (
                  <Detail label="Review Comment" value={riskAcceptance.review_comment} />
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="py-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Actions</h2>
              <TicketActions
                ticket={ticket}
                finding={ticket.finding}
                application={ticket.application}
                can={can}
                riskAcceptanceId={riskAcceptance?.id}
                pendingRetestId={pendingRetest?.id}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}
