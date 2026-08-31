import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ListChecks, ShieldCheck, Zap } from "lucide-react";
import { LoadingState, ErrorState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, PlatformBadge } from "@/components/data-display";
import { Badge } from "@/components/ui/badge";
import { EvidenceViewer, type EvidenceItem } from "@/components/evidence";
import { AssessmentSidebar } from "@/components/assessment-sidebar";
import { TestRunStages } from "@/components/assessment-progress";
import { RunEventTimeline } from "@/components/run-events";
import { CtaCard } from "@/components/cta-card";
import { ConversationPanel } from "@/components/conversation-panel";
import {
  useAssessment,
  useAssessmentMessages,
  useFindings,
  useProfiles,
  useRiskCatalogue,
  useSendAssessmentMessage,
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
  mapVerdictToFindingStatus,
  riskProgressInRun,
  type RiskRunPhase,
  type RunCancelToken,
} from "@/data/sync";
import { useAuth } from "@/auth/useAuth";
import { riskIcon } from "@/lib/entity-icons";
import { hasAutomation } from "@/lib/risk-automation";
import { cn, errorMessage, formatDate, formatDuration } from "@/lib/utils";
import type { Application, Finding } from "@/data/types";

const MANUAL_REPORT_TEMPLATE = `Status: [At Risk / Reduced Risk / Inconclusive]

Notes:
(Add your observations here…)

Evidence:
(Attach screenshots or screen recordings)`;

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

  const { data: assessment } = useAssessment(assessmentId);
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
  const { data: messages, isLoading: messagesLoading } = useAssessmentMessages(assessmentId);
  const sendMessage = useSendAssessmentMessage(assessmentId ?? "");

  const appExternalId = assessment?.application?.external_id ?? undefined;
  const { data: history, isLoading, isError, refetch } = useTestRunHistory(appExternalId, testId);
  const thread = useMemo(
    () => [...(history ?? [])].sort((a, b) => a.started_at.localeCompare(b.started_at)),
    [history],
  );

  const [watching, setWatching] = useState(false);
  const [startedRunId, setStartedRunId] = useState<string | undefined>();
  const [progressOpen, setProgressOpen] = useState(true);
  const [runError, setRunError] = useState<string | null>(null);
  const [stoppedWatchingRunId, setStoppedWatchingRunId] = useState<string | undefined>();
  const highlightedRef = useRef<HTMLLIElement>(null);
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

  useEffect(() => {
    if (runId) highlightedRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [runId, thread.length]);

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
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{risk.description}</p>
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

        <Card>
          <CardContent className="py-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Automated Test History</h2>

            {isLoading && <LoadingState label="Loading run history…" />}
            {isError && <ErrorState message="Unable to load run history." onRetry={() => refetch()} />}

            {!isLoading && !isError && thread.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {automated ? "No automated runs yet." : "This test is manual only."}
                </p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {!automated
                    ? "There is no automation for this security test, so no runs will appear here."
                    : can("run_test")
                      ? "Run an automated test to start building a history for this check."
                      : "No automated runs have been recorded for this test yet."}
                </p>
              </div>
            )}

            {!isLoading && thread.length > 0 && (
              <ol className="space-y-4">
                {thread.map((run) => (
                  <li
                    key={run.run_timestamp}
                    ref={run.run_timestamp === runId ? highlightedRef : undefined}
                    className={cn(
                      "flex gap-3 rounded-lg p-2 transition-colors",
                      run.run_timestamp === runId && "ring-2 ring-primary/40",
                    )}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-semibold text-foreground">Automated Test</span>
                        <span className="text-xs text-muted-foreground">{formatDate(run.started_at)}</span>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/40 p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <StatusBadge status={mapVerdictToFindingStatus(run.verdict)} />
                          <span className="text-xs text-muted-foreground">
                            {run.status} · {formatDuration(run.duration_seconds)}
                          </span>
                        </div>
                        <p className="text-sm text-foreground">{run.summary}</p>
                        {run.evidence.length > 0 && (
                          <div className="mt-3">
                            <EvidenceViewer
                              items={run.evidence.map(
                                (e, i): EvidenceItem => ({
                                  id: `${run.run_timestamp}-${i}`,
                                  name: e.label,
                                  kind: e.kind,
                                  url: assessmentApi.evidenceFileUrl(run.run_timestamp, e.path),
                                  source: "Automation backend",
                                }),
                              )}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <ConversationPanel
          messages={messages}
          isLoading={messagesLoading}
          currentProfileId={profile?.id}
          profileMap={profileMap}
          canComment={can("comment_ticket")}
          onSend={(message) => sendMessage.mutateAsync(message)}
          sending={sendMessage.isPending}
          emptyStateDescription="Start the conversation to begin your manual test."
          draftTemplate={MANUAL_REPORT_TEMPLATE}
        />
      </div>
    </div>
  );
}
