/**
 * Security test page for one assessment risk: running automation, evidence and the conversation.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ListChecks, Zap } from "lucide-react";
import { LoadingState, ErrorState } from "@/components/layout/page-blocks";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, PlatformBadge, SeverityBadge } from "@/components/shared/badges-and-table";
import { Badge } from "@/components/ui/badge";
import { EvidenceList } from "@/components/evidence/evidence";
import { EvidenceRail, RiskDetailGrid, RiskHeader, RiskWorkspace } from "@/components/layout/risk-workspace";
import { AssessmentSidebar } from "@/components/assessment/assessment-sidebar";
import { TestRunStages } from "@/components/assessment/assessment-progress";
import { RunEventTimeline } from "@/components/assessment/run-events";
import { CtaCard } from "@/components/shared/cta-card";
import { RiskConversationPanel } from "@/components/conversation/conversation-panel";
import { RiskConversationActions } from "@/components/conversation/reassessment-queue";
import { useRiskComposer } from "@/hooks/conversation/composer";
import {
  useAssessment,
} from "@/hooks/queries/assessments";
import { useFindings } from "@/hooks/queries/evidence";
import {
  useRiskCatalogue,
  useActiveRun,
  useResyncRun,
  useRunEvents,
  useRunSyncStatus,
} from "@/hooks/queries/automation";
import { useFindingRetests, useFindingTickets } from "@/hooks/queries/tickets";
import { useRiskWorkspaceData } from "@/hooks/risk-workspace-data";
import { DashboardSyncNotice } from "@/components/assessment/dashboard-sync-notice";
import { assessmentApi, defaultConfigPath } from "@/automation-api/endpoints";
import {
  riskProgressInRun,
  runAndWait,
  type RiskRunPhase,
  type RunCancelToken,
} from "@/workflows/automation-run";
import { useAuth } from "@/auth/auth-context";
import { hasRole } from "@/auth/permissions";
import { createDebug } from "@/lib/debug";
import { riskIcon } from "@/domain/assessment/entity-icons";
import { latestResultDetail } from "@/domain/evidence/automation-evidence";
import { PlaintextLiteralsCard } from "@/components/evidence/plaintext-literals";
import { LatestResultPanel } from "@/components/assessment/latest-result";
import { nextReassessment } from "@/domain/remediation/reassessments";
import { activeRemediationTicket, resumableRemediationTicket } from "@/domain/remediation/resolve-rules";
import { cn, errorMessage, formatDate } from "@/lib/utils";
import { findingsByTestId } from "@/domain/assessment/assessments";
import { assessmentKeys, automationKeys, evidenceKeys, ticketKeys } from "@/hooks/queries/keys";
import { retestData } from "@/database/retests";

const debug = createDebug("pages:assess:test-detail");

/** Keys the test page on :testId so the routes sharing this element remount it per test. */
export default function TestDetail() {
  const { testId } = useParams<{ testId: string }>();
  return <TestPage key={testId} />;
}

/** Shows a risk's test controls, run progress, evidence and conversation within its assessment. */
function TestPage() {
  const { assessmentId, testId, runId } = useParams<{
    assessmentId: string;
    testId: string;
    runId?: string;
  }>();
  const queryClient = useQueryClient();
  const { profile, can } = useAuth();
  const isSecurity = hasRole(profile?.roles, "security");

  const assessmentQuery = useAssessment(assessmentId);
  const assessment = assessmentQuery.data;
  const platform = assessment?.application?.platform;
  const { data: risks } = useRiskCatalogue(platform);
  const risk = useMemo(() => risks?.find((r) => r.risk_id === testId), [risks, testId]);

  const { data: findings } = useFindings({ applicationId: assessment?.application_id });
  const findingByTestId = useMemo(() => findingsByTestId(findings), [findings]);
  const currentFinding = testId ? findingByTestId.get(testId) : undefined;

  const appExternalId = assessment?.application?.external_id ?? undefined;
  const canComment = can("comment_risk_conversation");
  const {
    conversation,
    entries,
    attachments,
    attachmentsByEntry,
    profileMap,
    history: historyQuery,
    timeline,
    newest,
    railEvidence,
    analysisRef,
    analysis,
    literals,
  } = useRiskWorkspaceData({
    applicationId: assessment?.application_id,
    applicationExternalId: appExternalId,
    riskId: testId,
    findingId: currentFinding?.id,
    originAssessmentId: assessmentId,
    canComment,
  });
  const { data: history, isLoading, isError, refetch } = historyQuery;
  const { data: findingTickets } = useFindingTickets(currentFinding?.id);
  const { data: retests } = useFindingRetests(currentFinding?.id);
  const remediationTicket =
    activeRemediationTicket(currentFinding?.id ?? "", findingTickets) ??
    resumableRemediationTicket(currentFinding?.id ?? "", findingTickets);
  const composer = useRiskComposer({
    conversation: conversation.data,
    finding: currentFinding,
    ticket: remediationTicket,
    can,
  });

  const [watching, setWatching] = useState(false);
  const [startedRunId, setStartedRunId] = useState<string | undefined>();
  const [progressOpen, setProgressOpen] = useState(true);
  const [runError, setRunError] = useState<string | null>(null);
  const [stoppedWatchingRunId, setStoppedWatchingRunId] = useState<string | undefined>();
  const cancelRef = useRef<RunCancelToken>({ cancelled: false });

  const { run: activeRun, platformRun } = useActiveRun({ platform, appExternalId, riskId: testId });
  const adoptedRun = activeRun && activeRun.run_id !== stoppedWatchingRunId ? activeRun : undefined;
  const activeRunId = startedRunId ?? adoptedRun?.run_id;
  const { events: runEvents, streamState } = useRunEvents(activeRunId, !!activeRunId);

  // Latched: the run outlives its /runs "running" entry, and its sync outlives the run.
  const [watchedRunId, setWatchedRunId] = useState<string | undefined>();
  useEffect(() => {
    if (activeRunId) {
      debug("watches run", { runId: activeRunId });
      setWatchedRunId(activeRunId);
    }
  }, [activeRunId]);
  const { data: sync } = useRunSyncStatus(watchedRunId, { enabled: !watching && !adoptedRun });
  const resync = useResyncRun(watchedRunId);

  const progress = riskProgressInRun(runEvents, adoptedRun, appExternalId, testId);
  const executing = watching || progress?.phase === "running";
  const queued = progress?.phase === "queued";
  // The device takes one run at a time, so any run at all blocks starting this test.
  const deviceBusy = !executing && !queued && !!platformRun;
  const busy = executing || queued || deviceBusy;

  const observedPhaseRef = useRef<RiskRunPhase | undefined>();
  useEffect(() => {
    const previous = observedPhaseRef.current;
    observedPhaseRef.current = progress?.phase;
    if (previous !== "running" || progress?.phase === "running") return;
    debug("refreshes after observed risk finishes", { previous, phase: progress?.phase ?? null });
    void refetch();
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.detail(assessmentId) });
    void queryClient.invalidateQueries({ queryKey: evidenceKeys.findings() });
  }, [progress?.phase, refetch, queryClient, assessmentId]);

  /** Runs this risk's automated test, claiming any pending reassessment, and refreshes results when it ends. */
  async function runTest() {
    if (!platform || !appExternalId || !testId) {
      debug("cannot run test", { hasPlatform: !!platform, hasAppExternalId: !!appExternalId, testId });
      return;
    }
    debug("runs test", { platform, appExternalId, testId, findingId: currentFinding?.id });
    setWatching(true);
    setStartedRunId(undefined);
    setStoppedWatchingRunId(undefined);
    setRunError(null);
    setProgressOpen(true);
    cancelRef.current = { cancelled: false };
    const claim = nextReassessment(retests);
    try {
      if (claim) {
        debug("claims reassessment", { retestId: claim.id });
        await retestData.startRun(claim.id);
      }
      const { run, outcome } = await runAndWait(
        { platform, config_path: defaultConfigPath(platform), apps: appExternalId, risks: testId },
        (started) => {
          debug("starts run", { runId: started.run_id, retestId: claim?.id });
          setStartedRunId(started.run_id);
          return Promise.all([
            claim ? retestData.markRunning(claim.id, started.run_id) : Promise.resolve(),
            queryClient.invalidateQueries({ queryKey: automationKeys.runs() }),
          ]);
        },
        cancelRef.current,
      );
      debug("finishes run", { runId: run.run_id, status: run.status, outcome });

      if (outcome === "failed") {
        setRunError(run.error ?? `Run ended with status "${run.status}".`);
      } else if (outcome === "cancelledWaiting") {
        setRunError(
          "Stopped watching this run. It is still going on the automation host, which syncs the result on its own.",
        );
      } else if (outcome === "timedOutWaiting") {
        setRunError(
          "Stopped waiting after the polling window. The run is still going on the automation host, which syncs the result on its own.",
        );
      }

      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: assessmentKeys.detail(assessmentId) }),
        queryClient.invalidateQueries({ queryKey: evidenceKeys.findings() }),
        queryClient.invalidateQueries({ queryKey: ticketKeys.findingRetests(currentFinding?.id) }),
      ]);
    } catch (err) {
      debug("fails to run test", { testId, error: err });
      setRunError(errorMessage(err, "Unable to run this test."));
    } finally {
      setWatching(false);
    }
  }

  /** Stops waiting on the current run while leaving it running on the automation host. */
  function stopWaiting() {
    debug("stops waiting for run", { runId: activeRunId });
    cancelRef.current.cancelled = true;
    setStoppedWatchingRunId(activeRunId);
    setStartedRunId(undefined);
    setWatching(false);
  }

  // RLS hides out-of-scope assessments, so an empty success is a permission answer, not a slow load.
  if (assessmentQuery.isSuccess && !assessment) {
    return <ErrorState message="You do not have access to this assessment." />;
  }
  if (!assessment || !risk) {
    return <LoadingState label="Loading test…" />;
  }

  const RiskIcon = riskIcon(risk.name);
  const automated = risk.automation_available;

  return (
    <RiskWorkspace
      sidebar={
        <AssessmentSidebar
          application={assessment.application}
          assessment={assessment}
          risks={risks}
          findingByTestId={findingByTestId}
          activeTestId={testId}
        />
      }
    >
      <RiskHeader
        icon={RiskIcon}
        name={risk.name}
        description={risk.description}
        badges={
          <>
            {currentFinding && <StatusBadge status={currentFinding.status} />}
            {currentFinding && <SeverityBadge severity={currentFinding.severity} />}
            {platform && <PlatformBadge platform={platform} />}
          </>
        }
        meta={
          remediationTicket && can("view_resolve") && assessment.application_id && testId ? (
            <Link
              to={`/resolve/applications/${assessment.application_id}/risks/${encodeURIComponent(testId)}`}
              className="font-medium text-primary hover:underline"
            >
              Open the remediation workspace
            </Link>
          ) : undefined
        }
      />

      <RiskDetailGrid
        rail={
          <EvidenceRail count={railEvidence.length}>
            {isLoading && !history ? (
              <LoadingState label="Loading evidence…" />
            ) : isError ? (
              <ErrorState
                message="The automation backend could not provide this risk's results."
                onRetry={() => {
                  debug("retries evidence load", { testId });
                  void refetch();
                }}
              />
            ) : (
              <EvidenceList items={railEvidence} />
            )}
          </EvidenceRail>
        }
      >
        <div className={cn("grid grid-cols-1 items-stretch gap-3", can("run_test") && "sm:grid-cols-2")}>
          {can("run_test") &&
            (automated ? (
              <Card className={cn("h-full p-3.5", !busy && "border-primary/50 bg-primary/5")}>
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      {currentFinding ? "Run this test again" : "Run automated test"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {queued
                        ? "This test is part of a run already under way — it starts as soon as the tests ahead of it finish."
                        : deviceBusy
                          ? "The test device is busy with a run in progress. It drives one test at a time, so this has to wait for that run to finish."
                          : currentFinding
                            ? "Re-runs only this security test and updates its result."
                            : "The environment is already set up — this starts running straight away."}
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <Button size="sm" onClick={() => void runTest()} disabled={busy}>
                        {executing
                          ? "Running…"
                          : queued
                            ? "Waiting its turn"
                            : deviceBusy
                              ? "Device busy"
                              : currentFinding
                                ? "Run Again"
                                : "Run Automated Test"}
                      </Button>
                      {executing && (
                        <Button size="sm" variant="ghost" onClick={stopWaiting}>
                          Stop waiting
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="h-full p-3.5 opacity-60">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-muted-foreground">Run automated test</p>
                      <Badge tone="neutral">Unavailable</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      This security test has no automation. Follow the manual steps instead.
                    </p>
                    <div className="mt-2.5">
                      <Button size="sm" disabled className="cursor-not-allowed">
                        Run Automated Test
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          <CtaCard
            icon={ListChecks}
            title="Follow manual steps"
            description="You'll be guided through the steps to test this risk manually."
            to={`/assessments/${assessmentId}/tests/${testId}/manual`}
          />
        </div>
        {runError && <p className="text-xs text-danger">{runError}</p>}

        {!isSecurity && <LatestResultPanel result={latestResultDetail(newest)} />}

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
              currentFinding
                ? `/resolve/findings/${currentFinding.id}/controls/${encodeURIComponent(controlId)}`
                : "#"
            }
          />
        )}

        {(executing || queued) && (
          <Card className="border-primary/40">
            <CardContent className="py-4">
              <button
                type="button"
                onClick={() => {
                  debug("toggles run progress", { open: !progressOpen });
                  setProgressOpen((o) => !o);
                }}
                className="flex w-full items-center justify-between gap-2"
              >
                <span className="text-sm font-semibold text-foreground">
                  {executing ? "Automated test is running" : "Waiting for the test device"}
                </span>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", progressOpen && "rotate-180")} />
              </button>
              {progressOpen && (
                <div className="mt-3">
                  {!watching && adoptedRun && (
                    <p className="mb-3 text-xs text-muted-foreground">
                      Part of a run started {formatDate(adoptedRun.started_at)}
                      {progress && progress.total > 1
                        ? ` covering ${progress.total} tests, ${progress.completed} done so far`
                        : ""}
                      . Tests run one at a time on the device, and the run continues whether or not
                      this page is open.
                    </p>
                  )}
                  {executing ? (
                    <TestRunStages
                      testingDescription={`Executing test cases to verify ${risk.name.toLowerCase()} protection…`}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This test has not started yet — it begins once the tests ahead of it in this
                      run have finished.
                    </p>
                  )}
                  <div className="mt-4">
                    <RunEventTimeline events={runEvents} streamState={streamState} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <DashboardSyncNotice
          sync={sync}
          onRetry={() => {
            debug("requests run resync", { runId: watchedRunId });
            resync.mutate(undefined, {
              onSuccess: (data) => debug("resyncs run", { runId: watchedRunId, status: data?.status }),
              onError: (error) => debug("fails to resync run", { runId: watchedRunId, error }),
            });
          }}
          retrying={resync.isPending}
          retryError={resync.isError ? errorMessage(resync.error, "Could not start the sync.") : null}
        />
      </RiskDetailGrid>

      {can("view_risk_conversation") && (
          <RiskConversationPanel
            items={timeline}
            isLoading={conversation.isLoading || entries.isLoading || isLoading}
            isError={conversation.isError || entries.isError}
            onRetry={() => {
              debug("retries conversation load", { conversationId: conversation.data?.id, testId });
              void conversation.refetch();
              void entries.refetch();
            }}
            historyError={isError}
            onRetryHistory={() => {
              debug("retries conversation history", { testId });
              void refetch();
            }}
            attachmentsByEntry={attachmentsByEntry}
            attachmentsError={attachments.isError}
            onRetryAttachments={() => {
              debug("retries attachments load", { entryCount: entries.data?.length ?? 0 });
              void attachments.refetch();
            }}
            evidenceUrl={assessmentApi.evidenceFileUrl}
            highlightRunTimestamp={runId}
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
            emptyStateDescription={
              automated
                ? "Every automated run of this risk appears here, alongside the discussion, classification decisions and reassessments."
                : "This risk has no automation. Discuss it with the other team, record a classification decision, or ask for a reassessment."
            }
          actions={
            <RiskConversationActions
              conversation={conversation.data}
              finding={currentFinding}
              application={assessment.application}
              ticket={remediationTicket}
              retests={retests}
              can={can}
              profileId={profile?.id}
            />
          }
        />
      )}
    </RiskWorkspace>
  );
}
