import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { LoadingState, ErrorState, EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { SeverityBadge, StatusBadge } from "@/components/data-display";
import { ToneBadge } from "@/components/resolve-display";
import { RiskSidebar, type RiskSidebarEntry } from "@/components/risk-sidebar";
import {
  EvidenceRail,
  FindingSummary,
  RiskDetailGrid,
  RiskHeader,
  RiskWorkspace,
} from "@/components/risk-workspace";
import { WorkOnRiskButton } from "@/components/ticket-actions";
import { EvidenceList } from "@/components/evidence";
import { RiskConversationPanel } from "@/components/conversation-panel";
import ResolveTicket from "@/pages/ResolveTicket";
import {
  useApplications,
  useFindingEvidenceItems,
  useFindings,
  useProfiles,
  useRiskCatalogue,
  useRiskConversation,
  useRiskConversationAttachments,
  useRiskConversationEntries,
  useSendRiskMessage,
  useTestRunHistory,
  useTickets,
} from "@/hooks/queries";
import { assessmentApi } from "@/api/automation-services";
import { conversationTimeline } from "@/lib/conversation-timeline";
import {
  activeRemediationTicket,
  developerTicketLabel,
  resumableRemediationTicket,
} from "@/lib/resolve";
import { riskIcon } from "@/lib/entity-icons";

export default function ResolveRisk() {
  const { riskId } = useParams<{ riskId: string }>();
  return <RiskPage key={riskId} />;
}

function RiskPage() {
  const { applicationId, riskId } = useParams<{ applicationId: string; riskId: string }>();
  const { profile, can } = useAuth();

  const applications = useApplications();
  const application = applications.data?.find((candidate) => candidate.id === applicationId);
  const findings = useFindings({ applicationId });
  const tickets = useTickets({ type: "remediation", applicationId });
  const { data: risks } = useRiskCatalogue(application?.platform);

  const finding = useMemo(
    () => (findings.data ?? []).find((candidate) => candidate.test_id === riskId),
    [findings.data, riskId],
  );
  const risk = useMemo(() => risks?.find((entry) => entry.risk_id === riskId), [risks, riskId]);

  const ticket = finding
    ? (activeRemediationTicket(finding.id, tickets.data) ??
      resumableRemediationTicket(finding.id, tickets.data))
    : undefined;

  const canComment = can("comment_risk_conversation");
  const conversation = useRiskConversation(applicationId, riskId, finding?.id, {
    create: canComment,
    originAssessmentId: finding?.assessment_id,
  });
  const entries = useRiskConversationEntries(conversation.data?.id);
  const attachments = useRiskConversationAttachments(
    useMemo(() => (entries.data ?? []).map((entry) => entry.id), [entries.data]),
  );
  const attachmentsByEntry = useMemo(() => {
    const map = new Map<string, typeof attachments>();
    for (const attachment of attachments) {
      map.set(attachment.entry_id, [...(map.get(attachment.entry_id) ?? []), attachment]);
    }
    return map;
  }, [attachments]);
  const sendMessage = useSendRiskMessage(conversation.data?.id);
  const { data: profiles } = useProfiles();
  const profileMap = useMemo(() => new Map((profiles ?? []).map((p) => [p.id, p])), [profiles]);

  const history = useTestRunHistory(application?.external_id ?? undefined, riskId);
  const timeline = useMemo(
    () => conversationTimeline(entries.data, history.data),
    [entries.data, history.data],
  );
  const securityEvidence = useFindingEvidenceItems(finding?.id);

  // The sidebar lists the risks this application actually has findings for, so a
  // developer never navigates into a risk security has not raised.
  const sidebarRisks = useMemo<RiskSidebarEntry[]>(() => {
    const byRisk = new Map((risks ?? []).map((entry) => [entry.risk_id, entry.name]));
    return (findings.data ?? [])
      .filter((candidate) => candidate.test_id)
      .map((candidate) => {
        const related =
          activeRemediationTicket(candidate.id, tickets.data) ??
          resumableRemediationTicket(candidate.id, tickets.data);
        const label = developerTicketLabel(related?.status);
        return {
          riskId: candidate.test_id as string,
          name: byRisk.get(candidate.test_id as string) ?? candidate.title,
          status: candidate.status,
          note: label ? { label: label.label, tone: label.tone } : undefined,
        };
      });
  }, [findings.data, risks, tickets.data]);

  const resolved = (findings.data ?? []).filter((c) => c.status === "reduced_risk").length;
  const actionable = (findings.data ?? []).filter(
    (c) => c.status === "at_risk" || c.status === "reduced_risk",
  ).length;

  // The application is the page's identity: once it is known — usually from the
  // already-cached list — the shell renders and findings fill in beneath it.
  if (!application && applications.isLoading) return <LoadingState label="Loading…" />;
  if (applications.isError || !application) {
    return (
      <ErrorState
        message="Unable to load this application."
        onRetry={() => {
          void applications.refetch();
          void findings.refetch();
        }}
      />
    );
  }

  const RiskIcon = riskIcon(risk?.name ?? finding?.title ?? "");
  const ticketLabel = developerTicketLabel(ticket?.status);

  return (
    <RiskWorkspace
      sidebar={
        <RiskSidebar
          backTo="/resolve"
          backLabel="Back to Resolve"
          application={application}
          progress={{ completed: resolved, total: actionable, label: "findings resolved" }}
          risks={sidebarRisks}
          activeRiskId={riskId}
          riskHref={(id) => `/resolve/applications/${applicationId}/risks/${id}`}
          emptyMessage="No findings need your attention on this application."
          heading="Findings"
        />
      }
    >
      {findings.isLoading ? (
        <LoadingState label="Loading findings…" />
      ) : findings.isError ? (
        <ErrorState
          message="Unable to load findings for this application."
          onRetry={() => void findings.refetch()}
        />
      ) : !finding ? (
        <EmptyState
          title="Security has not raised this risk on this application"
          description="Choose a finding from the list to start or continue remediation."
        />
      ) : (
        <>
          <RiskHeader
            icon={RiskIcon}
            name={risk?.name ?? finding.title}
            description={risk?.description || finding.description || "No description recorded."}
            badges={
              <>
                <SeverityBadge severity={finding.severity} />
                <StatusBadge status={finding.status} />
                {ticketLabel && <ToneBadge tone={ticketLabel.tone} label={ticketLabel.label} />}
              </>
            }
          />

          <RiskDetailGrid
            rail={
              <EvidenceRail
                title="Security evidence"
                count={(securityEvidence.data ?? []).length}
              >
                <EvidenceList items={securityEvidence.data ?? []} />
              </EvidenceRail>
            }
          >
            <FindingSummary finding={finding} />

            {!ticket && (
              <Card>
                <CardContent className="py-3.5">
                  <WorkOnRiskButton finding={finding} application={application} />
                </CardContent>
              </Card>
            )}

            {ticket && <ResolveTicket ticketId={ticket.id} embedded />}
          </RiskDetailGrid>

          {can("view_risk_conversation") && (
              <RiskConversationPanel
                items={timeline}
                isLoading={conversation.isLoading || entries.isLoading || history.isLoading}
                isError={conversation.isError || entries.isError}
                onRetry={() => {
                  void conversation.refetch();
                  void entries.refetch();
                }}
                historyError={history.isError}
                onRetryHistory={() => void history.refetch()}
                attachmentsByEntry={attachmentsByEntry}
                evidenceUrl={assessmentApi.evidenceFileUrl}
                currentProfileId={profile?.id}
                profileMap={profileMap}
                canComment={canComment && !!conversation.data}
                composerNote={
                  canComment
                    ? "This conversation could not be opened, so there is nothing to post to yet. Retry above."
                    : undefined
                }
                onSend={(input) => sendMessage.mutateAsync(input)}
                sending={sendMessage.isPending}
                sendError={sendMessage.error}
                emptyStateDescription="Ask security about this risk, or record what you have changed. Automated runs, classification decisions and reassessments appear here too."
              />
          )}
        </>
      )}
    </RiskWorkspace>
  );
}
