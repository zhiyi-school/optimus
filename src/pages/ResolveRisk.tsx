import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { LoadingState, ErrorState, EmptyState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { PlatformBadge, SeverityBadge, StatusBadge } from "@/components/data-display";
import { ToneBadge } from "@/components/resolve-display";
import { RiskSidebar, type RiskSidebarEntry } from "@/components/risk-sidebar";
import { EvidenceRail, RiskDetailGrid, RiskHeader, RiskWorkspace } from "@/components/risk-workspace";
import { RiskConversationActions, WorkOnRiskButton } from "@/components/ticket-actions";
import { useRiskComposer } from "@/hooks/conversation-composer";
import { EvidenceList } from "@/components/evidence";
import { RiskConversationPanel } from "@/components/conversation-panel";
import ResolveTicket from "@/pages/ResolveTicket";
import {
  useApplications,
  useFindingEvidenceItems,
  useFindingRetests,
  useFindings,
  useProfiles,
  useRiskCatalogue,
  useRiskConversation,
  useRiskConversationAttachments,
  useRiskConversationEntries,
  useTestRunHistory,
  useTickets,
  useCriticalFindings,
} from "@/hooks/queries";
import { assessmentApi } from "@/api/automation-services";
import { conversationTimeline } from "@/lib/conversation-timeline";
import { artifactNamed, combinedEvidence, latestResult } from "@/lib/automation-evidence";
import { CriticalFindingsTable } from "@/components/critical-findings";
import {
  activeRemediationTicket,
  developerRiskOrder,
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
  const attachmentRows = attachments.data;
  const attachmentsByEntry = useMemo(() => {
    const map = new Map<string, typeof attachmentRows>();
    for (const attachment of attachmentRows) {
      map.set(attachment.entry_id, [...(map.get(attachment.entry_id) ?? []), attachment]);
    }
    return map;
  }, [attachmentRows]);
  const { data: profiles } = useProfiles();
  const profileMap = useMemo(() => new Map((profiles ?? []).map((p) => [p.id, p])), [profiles]);

  const history = useTestRunHistory(application?.external_id ?? undefined, riskId);
  const timeline = useMemo(
    () => conversationTimeline(entries.data, history.data),
    [entries.data, history.data],
  );
  const securityEvidence = useFindingEvidenceItems(finding?.id);
  const newest = useMemo(
    () => latestResult(history.data, application?.external_id, riskId),
    [history.data, application?.external_id, riskId],
  );
  const railEvidence = useMemo(
    () => combinedEvidence(newest, securityEvidence.data, assessmentApi.evidenceFileUrl),
    [newest, securityEvidence.data],
  );
  const findingsRef = artifactNamed(newest, "critical_findings.json");
  const markdownArtifact = artifactNamed(newest, "critical_findings.md");
  const staticAnalysis = useCriticalFindings(newest?.run_timestamp, findingsRef?.ref);
  const retests = useFindingRetests(finding?.id);
  const composer = useRiskComposer({
    conversation: conversation.data,
    finding,
    ticket,
    retests: retests.data,
    can,
  });

  // Only the risks security has actually raised, in the catalogue's own order so
  // the list reads the same here as it does under Assess.
  const sidebarRisks = useMemo<RiskSidebarEntry[]>(
    () =>
      developerRiskOrder(risks, findings.data).map((finding) => {
        const related =
          activeRemediationTicket(finding.id, tickets.data) ??
          resumableRemediationTicket(finding.id, tickets.data);
        const label = developerTicketLabel(related?.status);
        return {
          riskId: finding.test_id as string,
          name: risks?.find((entry) => entry.risk_id === finding.test_id)?.name ?? finding.title,
          status: finding.status,
          note: label ? { label: label.label, tone: label.tone } : undefined,
        };
      }),
    [findings.data, risks, tickets.data],
  );

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
                <PlatformBadge platform={application.platform} />
                {ticketLabel && <ToneBadge tone={ticketLabel.tone} label={ticketLabel.label} />}
              </>
            }
          />

          <RiskDetailGrid
            rail={
              <EvidenceRail title="Evidence" count={railEvidence.length}>
                {history.isLoading && !history.data ? (
                  <LoadingState label="Loading evidence…" />
                ) : history.isError ? (
                  <ErrorState
                    message="The automation backend could not provide this risk's results."
                    onRetry={() => void history.refetch()}
                  />
                ) : (
                  <EvidenceList items={railEvidence} />
                )}
              </EvidenceRail>
            }
          >
            <CriticalFindingsTable
              findings={staticAnalysis.data}
              isLoading={staticAnalysis.isLoading}
              isError={staticAnalysis.isError}
              onRetry={() => void staticAnalysis.refetch()}
              jsonUrl={
                findingsRef && newest
                  ? assessmentApi.evidenceFileUrl(newest.run_timestamp, findingsRef.ref)
                  : undefined
              }
              markdownUrl={
                markdownArtifact && newest
                  ? assessmentApi.evidenceFileUrl(newest.run_timestamp, markdownArtifact.ref)
                  : undefined
              }
            />

            {!ticket && (
              <Card>
                <CardContent className="py-3.5">
                  <WorkOnRiskButton finding={finding} application={application} />
                </CardContent>
              </Card>
            )}

            {ticket && <ResolveTicket ticketId={ticket.id} />}
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
                attachmentsError={attachments.isError}
                onRetryAttachments={() => void attachments.refetch()}
                evidenceUrl={assessmentApi.evidenceFileUrl}
                currentProfileId={profile?.id}
                profileMap={profileMap}
                canComment={canComment && !!conversation.data}
                composerNote={
                  canComment
                    ? "This conversation could not be opened, so there is nothing to post to yet. Retry above."
                    : undefined
                }
                onSubmit={composer.submit}
                composerOffers={composer.offers}
                sending={composer.pending}
                sendError={composer.error}
                emptyStateDescription="Ask security about this risk, or record what you have changed. Automated runs, classification decisions and reassessments appear here too."
                actions={
                  <RiskConversationActions
                    conversation={conversation.data}
                    finding={finding}
                    application={application}
                    ticket={ticket}
                    retests={retests.data}
                    can={can}
                    profileId={profile?.id}
                  />
                }
              />
          )}
        </>
      )}
    </RiskWorkspace>
  );
}
