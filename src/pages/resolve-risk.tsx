/**
 * Developer risk workspace combining remediation, evidence and the risk conversation.
 */

import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/auth/auth-context";
import { LoadingState, ErrorState, EmptyState } from "@/components/common";
import { PlatformBadge, SeverityBadge, StatusBadge } from "@/components/data-display";
import { ToneBadge } from "@/components/resolve-display";
import { RiskSidebar, type RiskSidebarEntry } from "@/components/risk-sidebar";
import { EvidenceRail, RiskDetailGrid, RiskHeader, RiskWorkspace } from "@/components/risk-workspace";
import { RiskConversationActions } from "@/components/ticket-actions/composition";
import { useRiskComposer } from "@/hooks/conversation-composer";
import { EvidenceList } from "@/components/evidence";
import { RiskConversationPanel } from "@/components/conversation-panel";
import { RemediationSection } from "@/components/remediation-section";
import { useFindings } from "@/hooks/queries/evidence";
import { useRiskCatalogue } from "@/hooks/queries/automation";
import { useFindingRetests, useTickets } from "@/hooks/queries/tickets";
import { useApplications } from "@/hooks/queries/reference";
import { useRiskWorkspaceData } from "@/hooks/risk-workspace-data";
import { assessmentApi } from "@/automation-api/endpoints";
import { createDebug } from "@/lib/debug";
import { PlaintextLiteralsCard } from "@/components/plaintext-literals";
import {
  activeRemediationTicket,
  developerRiskOrder,
  developerTicketLabel,
  resumableRemediationTicket,
  testingProgress,
} from "@/domain/remediation/resolve-rules";
import { riskIcon } from "@/domain/assessment/entity-icons";

const debug = createDebug("page:ResolveRisk");

/** Remounts the risk page whenever the route's risk changes so per-risk state resets. */
export default function ResolveRisk() {
  const { riskId } = useParams<{ riskId: string }>();
  return <RiskPage key={riskId} />;
}

/** Shows a risk's finding, evidence, remediation and conversation, with a sidebar of raised risks. */
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
  const queueTicket = finding ? activeRemediationTicket(finding.id, tickets.data) : undefined;

  const canComment = can("comment_risk_conversation");
  const {
    conversation,
    entries,
    attachments,
    attachmentsByEntry,
    profileMap,
    history,
    timeline,
    newest,
    railEvidence,
    analysisRef,
    analysis,
    literals,
  } = useRiskWorkspaceData({
    applicationId,
    applicationExternalId: application?.external_id ?? undefined,
    riskId,
    findingId: finding?.id,
    originAssessmentId: finding?.assessment_id,
    canComment,
  });
  const retests = useFindingRetests(finding?.id);
  const composer = useRiskComposer({
    conversation: conversation.data,
    finding,
    ticket: queueTicket,
    can,
  });

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

  const tested = useMemo(
    () => testingProgress(findings.data ?? [], risks?.length ?? 0),
    [findings.data, risks],
  );

  if (!application && applications.isLoading) return <LoadingState label="Loading…" />;
  if (applications.isError || !application) {
    return (
      <ErrorState
        message="Unable to load this application."
        onRetry={() => {
          debug("retries application load", { applicationId });
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
          progress={{ completed: tested.completed, total: tested.total, label: "risks tested" }}
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
          onRetry={() => {
            debug("retries findings load", { applicationId });
            void findings.refetch();
          }}
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
                    onRetry={() => {
                      debug("retries evidence load", { applicationId, riskId });
                      void history.refetch();
                    }}
                  />
                ) : (
                  <EvidenceList items={railEvidence} />
                )}
              </EvidenceRail>
            }
          >
            {analysisRef && (
              <PlaintextLiteralsCard
                analysis={literals}
                isLoading={analysis.isLoading}
                isError={analysis.isError}
                onRetry={() => {
                  debug("retries plaintext analysis", { runTimestamp: newest?.run_timestamp });
                  void analysis.refetch();
                }}
                controlHref={(controlId) =>
                  `/resolve/findings/${finding.id}/controls/${encodeURIComponent(controlId)}`
                }
              />
            )}

            <RemediationSection ticketId={ticket?.id} finding={finding} />
          </RiskDetailGrid>

          {can("view_risk_conversation") && (
              <RiskConversationPanel
                items={timeline}
                isLoading={conversation.isLoading || entries.isLoading || history.isLoading}
                isError={conversation.isError || entries.isError}
                onRetry={() => {
                  debug("retries conversation load", { conversationId: conversation.data?.id, riskId });
                  void conversation.refetch();
                  void entries.refetch();
                }}
                historyError={history.isError}
                onRetryHistory={() => {
                  debug("retries conversation history", { riskId });
                  void history.refetch();
                }}
                attachmentsByEntry={attachmentsByEntry}
                attachmentsError={attachments.isError}
                onRetryAttachments={() => {
                  debug("retries attachments load", { entryCount: entries.data?.length ?? 0 });
                  void attachments.refetch();
                }}
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
                attachmentRetry={composer.attachmentRetry}
                onAbandonAttachment={composer.abandonAttachment}
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
