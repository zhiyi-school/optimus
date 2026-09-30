/**
 * Query hooks for the automation backend: risks, provisioning, runs, reports, sync and run events.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { assessmentApi, provisioningApi, syncApi, testApi } from "@/automation-api/endpoints";
import type { AutomationPlatform, DashboardSyncStatus, RunProgressEvent } from "@/automation-api/types";
import { findActiveRun, findPlatformRun, type ActiveRunFilter } from "@/workflows/automation-run";
import { syncPollInterval } from "@/domain/run/dashboard-sync";
import { dashboardSyncInvalidationPrefixes } from "./invalidation-rules";
import { automationKeys } from "@/hooks/query-keys";
import type { RunEventStreamState } from "@/domain/run/event-stream";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:automation");

/** Fetches a platform's risk catalogue from the automation backend. */
export function useRiskCatalogue(platform: AutomationPlatform | undefined) {
  return useQuery({
    queryKey: automationKeys.riskCatalogue(platform),
    queryFn: async () => {
      debug("fetches risk catalogue", { platform });
      const risks = await testApi.listRisks(platform as AutomationPlatform);
      debug("fetched risk catalogue", { platform, count: risks.length });
      return risks;
    },
    enabled: !!platform,
  });
}

const PROVISIONING_POLL_INTERVAL_MS = 30_000;

/** Fetches an app's provisioning state, optionally polling; resolves to null when the backend lacks support. */
export function useAppProvisioning(
  platform: AutomationPlatform | undefined,
  appId: string | null | undefined,
  opts: { poll?: boolean } = {},
) {
  return useQuery({
    queryKey: automationKeys.provisioning(platform, appId),
    queryFn: async () => {
      debug("fetches provisioning", { platform, appId, poll: Boolean(opts.poll) });
      const provisioning = await provisioningApi.getProvisioning(platform as AutomationPlatform, appId as string);
      debug("fetched provisioning", { platform, appId, supported: provisioning !== null });
      return provisioning;
    },
    enabled: !!platform && !!appId,
    refetchInterval: opts.poll ? PROVISIONING_POLL_INTERVAL_MS : false,
    retry: false,
  });
}

const ACTIVE_RUN_POLL_INTERVAL_MS = 5000;

/** Derives the app's in-flight run and any run holding the platform's device from polled run lists. */
export function useActiveRun(filter: ActiveRunFilter) {
  const enabled = !!filter.platform && !!filter.appExternalId;
  const { data } = useQuery({
    queryKey: automationKeys.runs(),
    queryFn: async () => {
      debug("fetches runs for active run", { platform: filter.platform, appExternalId: filter.appExternalId });
      const runs = await assessmentApi.listRuns();
      debug("fetched runs for active run", {
        count: runs.length,
        activeRunId: findActiveRun(runs, filter)?.run_id ?? null,
        platformRunId: findPlatformRun(runs, filter.platform)?.run_id ?? null,
      });
      return runs;
    },
    enabled,
    refetchInterval: ACTIVE_RUN_POLL_INTERVAL_MS,
    retry: false,
  });
  return {
    run: findActiveRun(data, filter),
    platformRun: findPlatformRun(data, filter.platform),
  };
}

/** Fetches automation report timestamps, optionally filtered by status. */
export function useAutomationReports(status?: string) {
  return useQuery({
    queryKey: automationKeys.reports(status),
    queryFn: async () => {
      debug("fetches automation reports", { status });
      const reports = await assessmentApi.listReports(status);
      debug("fetched automation reports", { status, count: reports.length });
      return reports;
    },
  });
}

/** Fetches a run's status, polling every two seconds while it runs when polling is requested. */
export function useRunStatus(runId: string | undefined, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: automationKeys.runStatus(runId),
    queryFn: async () => {
      debug("fetches run status", { runId });
      const run = await assessmentApi.getRun(runId as string);
      debug("fetched run status", { runId, status: run.status, keepsPolling: Boolean(opts.poll) && run.status === "running" });
      return run;
    },
    enabled: !!runId,
    refetchInterval: (query) => {
      if (!opts.poll) return false;
      const status = query.state.data?.status;
      return status === "running" ? 2000 : false;
    },
  });
}

/** Polls a run's dashboard sync status and invalidates dashboard data once the sync completes. */
export function useRunSyncStatus(runId: string | undefined, opts: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: automationKeys.runSyncStatus(runId),
    queryFn: async () => {
      debug("fetches run sync status", { runId });
      const sync = await syncApi.getRunSyncStatus(runId as string);
      debug("fetched run sync status", { runId, status: sync?.status });
      return sync;
    },
    enabled: !!runId && (opts.enabled ?? true),
    refetchInterval: (q) => syncPollInterval(q.state.data?.status, q.state.dataUpdateCount + q.state.errorUpdateCount),
    retry: false,
  });

  const status = query.data?.status;
  const seenRef = useRef<DashboardSyncStatus | undefined>();
  const seenRunRef = useRef(runId);
  useEffect(() => {
    if (seenRunRef.current !== runId) {
      debug("tracks sync for new run", { runId, previousRunId: seenRunRef.current });
      seenRunRef.current = runId;
      seenRef.current = undefined;
    }
    const previous = seenRef.current;
    seenRef.current = status;
    if (status !== "completed" || previous === "completed") return;
    debug("sync completed, invalidates dashboard", { runId, prefixCount: dashboardSyncInvalidationPrefixes.length });
    for (const queryKey of dashboardSyncInvalidationPrefixes) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [runId, status, queryClient]);

  return query;
}

/** Requests a run resync and stores the returned sync status. */
export function useResyncRun(runId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => syncApi.resyncRun(runId as string),
    onMutate: () => debug("resyncs run", { runId }),
    onError: (error) => debug("resync run failed", { runId, error }),
    onSuccess: (data) => {
      debug("resync accepted", { runId, status: data?.status });
      queryClient.setQueryData(automationKeys.runSyncStatus(runId), data);
    },
  });
}

/** Builds a deduplication key from a run event's identifying fields. */
function runEventKey(event: RunProgressEvent) {
  return [
    event.timestamp ?? "",
    event.type,
    event.app_id ?? "",
    event.risk_id ?? "",
    event.test_case_id ?? "",
    event.status ?? "",
    event.error ?? "",
  ].join("|");
}

/** Streams a running run's events over SSE, deduplicating them and refreshing run status when done. */
export function useRunEvents(runId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  const seenRef = useRef<Set<string>>(new Set());
  const [events, setEvents] = useState<RunProgressEvent[]>([]);
  const [streamState, setStreamState] = useState<RunEventStreamState>("idle");

  useEffect(() => {
    seenRef.current = new Set();
    setEvents([]);

    if (!runId || !enabled) {
      debug("run stream idle", { runId, enabled });
      setStreamState("idle");
      return undefined;
    }

    if (typeof EventSource === "undefined") {
      debug("run stream unavailable, no EventSource", { runId });
      setStreamState("unavailable");
      return undefined;
    }

    const source = new EventSource(assessmentApi.eventsUrl(runId));
    let closedByClient = false;
    debug("run stream connecting", { runId });
    setStreamState("connecting");

    source.onopen = () => {
      debug("run stream open", { runId });
      setStreamState("open");
    };
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as RunProgressEvent;
        const key = runEventKey(event);
        if (!seenRef.current.has(key)) {
          seenRef.current.add(key);
          debug("run event", { runId, type: event.type, riskId: event.risk_id, status: event.status });
          setEvents((current) => [...current, event]);
        } else {
          debug("skips duplicate run event", { runId, type: event.type });
        }
        if (event.type === "done") {
          debug("run stream done, invalidates run", { runId });
          void queryClient.invalidateQueries({ queryKey: automationKeys.runStatus(runId) });
          void queryClient.invalidateQueries({ queryKey: automationKeys.runs() });
          closedByClient = true;
          source.close();
          setStreamState("closed");
        }
      } catch (error) {
        debug("run event unreadable, closes stream", { runId, error });
        setStreamState("unavailable");
        source.close();
      }
    };
    source.onerror = () => {
      debug("run stream error", { runId, closedByClient });
      if (!closedByClient) {
        setStreamState("unavailable");
        source.close();
      }
    };

    return () => {
      debug("run stream closes on cleanup", { runId });
      closedByClient = true;
      source.close();
    };
  }, [enabled, queryClient, runId]);

  return { events, streamState };
}

/** Fetches a completed run's results from its report summary. */
export function useRunResults(runTimestamp: string | undefined, enabled = true) {
  return useQuery({
    queryKey: automationKeys.runResults(runTimestamp),
    queryFn: async () => {
      debug("fetches run results", { runTimestamp });
      const results = await assessmentApi.getReportSummary(runTimestamp as string);
      debug("fetched run results", { runTimestamp });
      return results;
    },
    enabled: !!runTimestamp && enabled,
  });
}

/** Fetches an app's run history for one test. */
export function useTestRunHistory(appExternalId: string | undefined, testId: string | undefined) {
  return useQuery({
    queryKey: automationKeys.testHistory(appExternalId, testId),
    enabled: !!appExternalId && !!testId,
    queryFn: async () => {
      debug("fetches test history", { appExternalId, testId });
      const history = await assessmentApi.getTestHistory(appExternalId as string, testId as string);
      debug("fetched test history", { appExternalId, testId, count: history.length });
      return history;
    },
  });
}

const ANALYSIS_STALE_TIME_MS = 5 * 60_000;

/** Fetches one run's structured analysis document through the evidence endpoint. */
export function useIpaAnalysis(runTimestamp: string | undefined, ref: string | undefined) {
  return useQuery({
    queryKey: automationKeys.ipaAnalysis(runTimestamp, ref),
    queryFn: async () => {
      debug("fetches analysis", { runTimestamp, ref });
      const response = await fetch(
        assessmentApi.evidenceFileUrl(runTimestamp as string, ref as string),
      );
      debug("analysis response", { runTimestamp, ref, status: response.status });
      if (!response.ok) throw new Error(`Analysis unavailable (${response.status})`);
      return (await response.json()) as unknown;
    },
    enabled: !!runTimestamp && !!ref,
    staleTime: ANALYSIS_STALE_TIME_MS,
    retry: false,
  });
}
