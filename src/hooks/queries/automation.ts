import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { assessmentApi, configApi, provisioningApi, syncApi, testApi } from "@/api/automation-services";
import type { AutomationPlatform, DashboardSyncStatus, RunProgressEvent } from "@/api/automation-types";
import type { ControlDetail } from "@/api/playbook-types";
import { playbookApi } from "@/api/playbook-services";
import { findActiveRun, findPlatformRun, type ActiveRunFilter } from "@/data/sync";
import { SYNC_STATUS_POLL_INTERVAL_MS, syncPollInterval } from "@/lib/dashboard-sync";
import { selectableControls } from "@/lib/resolve";
import { dashboardSyncInvalidationPrefixes } from "./invalidation-rules";
import { automationKeys } from "@/hooks/query-keys";
import type { RunEventStreamState } from "@/lib/run-event-types";
import { createDebug } from "@/lib/debug";

export type { RunEventStreamState } from "@/lib/run-event-types";

const debug = createDebug("hooks:queries:automation");

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

export function useConfiguredApps(platform: AutomationPlatform | undefined) {
  return useQuery({
    queryKey: automationKeys.configuredApps(platform),
    queryFn: async () => {
      debug("fetches configured apps", { platform });
      const apps = await configApi.listApps(platform as AutomationPlatform);
      debug("fetched configured apps", { platform, count: apps.length });
      return apps;
    },
    enabled: !!platform,
  });
}

const PROVISIONING_POLL_INTERVAL_MS = 30_000;

/** Resolves to `null` when the backend has no provisioning support; callers fall back. */
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

export function useAutomationRuns() {
  return useQuery({
    queryKey: automationKeys.runs(),
    queryFn: async () => {
      debug("fetches automation runs");
      const runs = await assessmentApi.listRuns();
      debug("fetched automation runs", { count: runs.length });
      return runs;
    },
    refetchInterval: 5000,
  });
}

const ACTIVE_RUN_POLL_INTERVAL_MS = 5000;

/**
 * Re-derives the in-flight run from the automation host so navigating away and
 * back does not lose the progress a component was showing.
 */
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
    /** Any run holding the platform's device — it blocks starting another one. */
    platformRun: findPlatformRun(data, filter.platform),
  };
}

export function useAutomationReports(status?: string) {
  return useQuery({
    queryKey: [...automationKeys.reports(), status ?? null],
    queryFn: async () => {
      debug("fetches automation reports", { status });
      const reports = await assessmentApi.listReports(status);
      debug("fetched automation reports", { status, count: reports.length });
      return reports;
    },
  });
}

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

export function useDashboardSyncWorker(opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: automationKeys.syncWorker(),
    queryFn: async () => {
      debug("fetches sync worker status");
      const worker = await syncApi.getWorkerStatus();
      debug("fetched sync worker status", { poll: Boolean(opts.poll) });
      return worker;
    },
    refetchInterval: opts.poll ? SYNC_STATUS_POLL_INTERVAL_MS : false,
    retry: false,
  });
}

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

export function useReportSummary(runTimestamp: string | undefined) {
  return useQuery({
    queryKey: automationKeys.reportSummary(runTimestamp),
    queryFn: async () => {
      debug("fetches report summary", { runTimestamp });
      const summary = await assessmentApi.getReportSummary(runTimestamp as string);
      debug("fetched report summary", { runTimestamp });
      return summary;
    },
    enabled: !!runTimestamp,
  });
}

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

/** One run's structured analysis document, fetched through the evidence endpoint. */
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
    staleTime: 5 * 60_000,
    retry: false,
  });
}

const PLAYBOOK_POLL_INTERVAL_MS = 45_000;

/** The revision seen on arrival is kept in session memory only, never written to the database. */
export function usePlaybookRevisionWatch(
  platform: AutomationPlatform | undefined,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  const initial = useRef<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);

  const status = useQuery({
    queryKey: automationKeys.playbookStatus(platform),
    queryFn: async () => {
      debug("fetches playbook status", { platform });
      const playbookStatus = await playbookApi.getStatus(platform as AutomationPlatform);
      debug("fetched playbook status", { platform, revision: playbookStatus?.revision ?? null });
      return playbookStatus;
    },
    enabled: !!platform && enabled,
    retry: false,
    refetchInterval: enabled ? PLAYBOOK_POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: enabled,
  });

  const revision = status.data?.revision ?? null;

  useEffect(() => {
    if (!revision) return;
    if (initial.current === null) {
      debug("records arrival playbook revision", { revision });
      initial.current = revision;
      return;
    }
    if (initial.current === revision) return;
    debug("playbook revision changed, invalidates controls", { from: initial.current, to: revision });
    void queryClient.invalidateQueries({ queryKey: automationKeys.riskControlsPrefix() });
    void queryClient.invalidateQueries({ queryKey: automationKeys.controlPrefix() });
    void queryClient.invalidateQueries({ queryKey: automationKeys.controlSourcePrefix() });
  }, [revision, queryClient]);

  const changed = revision !== null && initial.current !== null && initial.current !== revision;

  return {
    revision,
    updated: changed && acknowledged !== revision,
    dismiss: () => setAcknowledged(revision),
  };
}

/** `undefined` while unknown, so an unreachable backend degrades to counting every stored row. */
export function useLiveControlKeys(risks: { platform: AutomationPlatform; riskId: string }[]) {
  const unique = [...new Map(risks.map((r) => [`${r.platform}/${r.riskId}`, r])).values()].sort(
    (a, b) => `${a.platform}/${a.riskId}`.localeCompare(`${b.platform}/${b.riskId}`),
  );

  const results = useQueries({
    queries: unique.map((risk) => ({
      queryKey: automationKeys.riskControls(risk.platform, risk.riskId),
      queryFn: async () => {
        debug("fetches live risk controls", { platform: risk.platform, riskId: risk.riskId });
        const controls = await playbookApi.listRiskControls(risk.platform, risk.riskId);
        debug("fetched live risk controls", { platform: risk.platform, riskId: risk.riskId, count: controls.length });
        return controls;
      },
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });

  return useMemo(() => {
    if (results.length === 0 || results.some((result) => !result.isSuccess)) return undefined;
    const controlIds = new Set<string>();
    const stepKeys = new Set<string>();
    const candidatesByRisk = new Map<string, ControlDetail[]>();
    results.forEach((result, index) => {
      const risk = unique[index];
      const candidates = selectableControls(result.data);
      if (risk) candidatesByRisk.set(risk.riskId, candidates);
      for (const control of candidates) {
        controlIds.add(control.control_id);
        for (const step of control.steps) stepKeys.add(step.step_key);
      }
    });
    return { controlIds, stepKeys, candidatesByRisk };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => `${r.status}:${r.dataUpdatedAt}`).join("|")]);
}
