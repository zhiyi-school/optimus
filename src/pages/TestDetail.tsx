import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ListChecks, Zap } from "lucide-react";
import { LoadingState, ErrorState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, PlatformBadge, SeverityBadge } from "@/components/data-display";
import { Badge } from "@/components/ui/badge";
import { AssessmentSidebar } from "@/components/assessment-sidebar";
import { TestRunStages } from "@/components/assessment-progress";
import { RunEventTimeline } from "@/components/run-events";
import { CtaCard } from "@/components/cta-card";
import { RiskConversationPanel } from "@/components/conversation-panel";
import { RiskConversationActions } from "@/components/ticket-actions";
import {
  useAssessment,
  useFindingRetests,
  useFindingTickets,
  useFindings,
  useProfiles,
  useRiskCatalogue,
  useRiskConversation,
  useRiskConversationAttachments,
  useRiskConversationEntries,
  useSendRiskMessage,
  useActiveRun,
  useResyncRun,
  useRunEvents,
  useRunSyncStatus,
  useTestRunHistory,
} from "@/hooks/queries";
import { DashboardSyncNotice } from "@/components/dashboard-sync-notice";
import { assessmentApi, defaultConfigPath } from "@/api/automation-services";
import {
  syncService,
  riskProgressInRun,
  type RiskRunPhase,
  type RunCancelToken,
} from "@/data/sync";
import { useAuth } from "@/auth/useAuth";
import { riskIcon } from "@/lib/entity-icons";
import { hasAutomation } from "@/lib/risk-automation";
import { conversationTimeline } from "@/lib/conversation-timeline";
import { activeRemediationTicket, resumableRemediationTicket } from "@/lib/resolve";
import { cn, errorMessage, formatDate } from "@/lib/utils";
import type { Application, Finding } from "@/data/types";

export default function TestDetail() {
  // Both routes share this element, so :testId changes without remounting.
  const { testId } = useParams<{ testId: string }>();
  return <TestPage key={testId} />;
}

function TestPage() {
  const { assessmentId, testId, runId } = useParams<{
    assessmentId: string;
    testId: string;
    runId?: string;
  }>();
  const queryClient = useQueryClient();
  const { profile, can } = useAuth();

  const assessmentQuery = useAssessment(assessmentId);
  const assessment = assessmentQuery.data;
  const platform = assessment?.application?.platform;
  const { data: risks } = useRiskCatalogue(platform);
  const risk = useMemo(() => risks?.find((r) => r.risk_id === testId), [risks, testId]);

  const { data: findings } = useFindings({ applicationId: assessment?.application_id });
  const findingByTestId = useMemo(() => {
    const map = new Map<string, Finding & { application: Application | null }>();
    for (const f of findings ?? []) {
      if (f.test_id) map.set(f.test_id, f);
    }
    return map;
  }, [findings]);
  const currentFinding = testId ? findingByTestId.get(testId) : undefined;

  const { data: profiles } = useProfiles();
  const profileMap = useMemo(() => new Map((profiles ?? []).map((p) => [p.id, p])), [profiles]);

  const canComment = can("comment_risk_conversation");
  const conversation = useRiskConversation(
    assessment?.application_id,
    testId,
    currentFinding?.id,
    { create: canComment, originAssessmentId: assessmentId },
  );
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
  const { data: findingTickets } = useFindingTickets(currentFinding?.id);
  const { data: retests } = useFindingRetests(currentFinding?.id);
  const remediationTicket =
    activeRemediationTicket(currentFinding?.id ?? "", findingTickets) ??
    resumableRemediationTicket(currentFinding?.id ?? "", findingTickets);

  const appExternalId = assessment?.application?.external_id ?? undefined;
  const { data: history, isLoading, isError, refetch } = useTestRunHistory(appExternalId, testId);
  const timeline = useMemo(() => conversationTimeline(entries.data, history), [entries.data, history]);

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
    if (activeRunId) setWatchedRunId(activeRunId);
  }, [activeRunId]);
  const { data: sync } = useRunSyncStatus(watchedRunId);
  const resync = useResyncRun(watchedRunId);

  const progress = riskProgressInRun(runEvents, adoptedRun, appExternalId, testId);
  // The device runs one risk at a time: being inside the run is not being executed by it.
  const executing = watching || progress?.phase === "running";
  const queued = progress?.phase === "queued";
  // The device takes one run at a time, so any run at all blocks starting this test.
  const deviceBusy = !executing && !queued && !!platformRun;
  const busy = executing || queued || deviceBusy;

  // A run this tab only observed still has to refresh the page once this risk is done.
  const observedPhaseRef = useRef<RiskRunPhase | undefined>();
  useEffect(() => {
    const previous = observedPhaseRef.current;
    observedPhaseRef.current = progress?.phase;
    if (previous !== "running" || progress?.phase === "running") return;
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] });
    void queryClient.invalidateQueries({ queryKey: ["findings"] });
  }, [progress?.phase, refetch, queryClient, assessmentId]);

  async function runTest() {
    if (!platform || !appExternalId || !testId) return;
    setWatching(true);
    setStartedRunId(undefined);
    setStoppedWatchingRunId(undefined);
    setRunError(null);
    setProgressOpen(true);
    cancelRef.current = { cancelled: false };
    try {
      const { run, outcome } = await syncService.runAndWait(
        { platform, config_path: defaultConfigPath(platform), apps: appExternalId, risks: testId },
        (started) => {
          setStartedRunId(started.run_id);
          return queryClient.invalidateQueries({ queryKey: ["automationRuns"] });
        },
        cancelRef.current,
      );

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
        queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] }),
        queryClient.invalidateQueries({ queryKey: ["findings"] }),
      ]);
    } catch (err) {
      setRunError(errorMessage(err, "Unable to run this test."));
    } finally {
      setWatching(false);
    }
  }

  function stopWaiting() {
    cancelRef.current.cancelled = true;
    setStoppedWatchingRunId(activeRunId);
    setStartedRunId(undefined);
    setWatching(false);
  }

  // RLS hides an assessment outside the viewer's application scope, so an empty
  // result here is a permission answer rather than a slow load.
  if (assessmentQuery.isSuccess && !assessment) {
    return <ErrorState message="You do not have access to this assessment." />;
  }
  if (!assessment || !risk) {
    return <LoadingState label="Loading test…" />;
  }

  const RiskIcon = riskIcon(risk.name);
  const automated = hasAutomation(risk);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <AssessmentSidebar
          application={assessment.application}
          assessment={assessment}
          risks={risks}
          findingByTestId={findingByTestId}
          activeTestId={testId}
        />
      </div>

      <div className="space-y-6 lg:col-span-2">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted">
            <RiskIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-foreground">{risk.name}</h1>
              {currentFinding && <StatusBadge status={currentFinding.status} />}
              {currentFinding && <SeverityBadge severity={currentFinding.severity} />}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{risk.description}</p>
            {(currentFinding || remediationTicket) && (
              <p className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                {currentFinding && (
                  <Link
                    to={`/findings/${currentFinding.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    View the finding
                  </Link>
                )}
                {remediationTicket && (
                  <Link
                    to={
                      can("view_resolve")
                        ? `/resolve/tickets/${remediationTicket.id}`
                        : `/tickets/${remediationTicket.id}`
                    }
                    className="font-medium text-primary hover:underline"
                  >
                    View the remediation ticket
                  </Link>
                )}
              </p>
            )}
          </div>
          {platform && <PlatformBadge platform={platform} />}
        </div>

        <div className={cn("grid grid-cols-1 items-stretch gap-4", can("run_test") && "sm:grid-cols-2")}>
          {can("run_test") &&
            (automated ? (
              <Card className={cn("h-full p-4", !busy && "border-primary/50 bg-primary/5")}>
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Zap className="h-4.5 w-4.5" />
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
                    <div className="mt-3 flex items-center gap-2">
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
              <Card className="h-full p-4 opacity-60">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Zap className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-muted-foreground">Run automated test</p>
                      <Badge tone="neutral">Unavailable</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      This security test has no automation. Follow the manual steps instead.
                    </p>
                    <div className="mt-3">
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
        {runError && <p className="-mt-2 text-xs text-danger">{runError}</p>}

        {(executing || queued) && (
          <Card className="border-primary/40">
            <CardContent className="py-4">
              <button
                type="button"
                onClick={() => setProgressOpen((o) => !o)}
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
          onRetry={() => resync.mutate()}
          retrying={resync.isPending}
          retryError={resync.isError ? errorMessage(resync.error, "Could not start the sync.") : null}
        />

        {can("view_risk_conversation") && (
          <RiskConversationPanel
            items={timeline}
            isLoading={conversation.isLoading || entries.isLoading || isLoading}
            isError={conversation.isError || entries.isError}
            onRetry={() => {
              void conversation.refetch();
              void entries.refetch();
            }}
            historyError={isError}
            onRetryHistory={() => void refetch()}
            attachmentsByEntry={attachmentsByEntry}
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
            onSend={(input) => sendMessage.mutateAsync(input)}
            sending={sendMessage.isPending}
            sendError={sendMessage.error}
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
              />
            }
          />
        )}
      </div>
    </div>
  );
}
