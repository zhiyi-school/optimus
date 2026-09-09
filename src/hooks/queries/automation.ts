import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { assessmentApi, configApi, provisioningApi, syncApi, testApi } from "@/api/automation-services";
import type { AutomationPlatform, DashboardSyncStatus, RunProgressEvent } from "@/api/automation-types";
import type { ControlDetail } from "@/api/playbook-types";
import { playbookApi } from "@/api/playbook-services";
import { findActiveRun, findPlatformRun, type ActiveRunFilter } from "@/data/sync";
import { SYNC_STATUS_POLL_INTERVAL_MS, syncPollInterval } from "@/lib/dashboard-sync";
import { parseCriticalFindings } from "@/lib/critical-findings";
import { selectableControls } from "@/lib/resolve";
import { dashboardSyncInvalidationPrefixes } from "./invalidation-rules";
import { automationKeys } from "@/hooks/query-keys";
import type { RunEventStreamState } from "@/lib/run-event-types";

export type { RunEventStreamState } from "@/lib/run-event-types";

const REFERENCE_DATA_STALE_TIME_MS = 5 * 60_000;

export function useRiskCatalogue(platform: AutomationPlatform | undefined) {
  return useQuery({
    queryKey: automationKeys.riskCatalogue(platform),
    queryFn: () => testApi.listRisks(platform as AutomationPlatform),
    enabled: !!platform,
  });
}

export function useConfiguredApps(platform: AutomationPlatform | undefined) {
  return useQuery({
    queryKey: automationKeys.configuredApps(platform),
    queryFn: () => configApi.listApps(platform as AutomationPlatform),
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
    queryFn: () =>
      provisioningApi.getProvisioning(platform as AutomationPlatform, appId as string),
    enabled: !!platform && !!appId,
    refetchInterval: opts.poll ? PROVISIONING_POLL_INTERVAL_MS : false,
    retry: false,
  });
}

export function useAutomationRuns() {
  return useQuery({
    queryKey: automationKeys.runs(),
    queryFn: assessmentApi.listRuns,
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
    queryFn: assessmentApi.listRuns,
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

export function useAutomationReports() {
  return useQuery({
    queryKey: automationKeys.reports(),
    queryFn: assessmentApi.listReports,
  });
}

export function useRunStatus(runId: string | undefined, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: automationKeys.runStatus(runId),
    queryFn: () => assessmentApi.getRun(runId as string),
    enabled: !!runId,
    refetchInterval: (query) => {
      if (!opts.poll) return false;
      const status = query.state.data?.status;
      return status === "running" ? 2000 : false;
    },
  });
}

export function useRunSyncStatus(runId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: automationKeys.runSyncStatus(runId),
    queryFn: () => syncApi.getRunSyncStatus(runId as string),
    enabled: !!runId,
    refetchInterval: (q) => syncPollInterval(q.state.data?.status),
    retry: false,
  });

  const status = query.data?.status;
  const seenRef = useRef<DashboardSyncStatus | undefined>();
  useEffect(() => {
    const previous = seenRef.current;
    seenRef.current = status;
    if (status !== "completed" || previous === undefined || previous === "completed") return;
    for (const queryKey of dashboardSyncInvalidationPrefixes) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [status, queryClient]);

  return query;
}

export function useResyncRun(runId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => syncApi.resyncRun(runId as string),
    onSuccess: (data) => {
      queryClient.setQueryData(automationKeys.runSyncStatus(runId), data);
    },
  });
}

export function useDashboardSyncWorker(opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: automationKeys.syncWorker(),
    queryFn: syncApi.getWorkerStatus,
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
      setStreamState("idle");
      return undefined;
    }

    if (typeof EventSource === "undefined") {
      setStreamState("unavailable");
      return undefined;
    }

    const source = new EventSource(assessmentApi.eventsUrl(runId));
    let closedByClient = false;
    setStreamState("connecting");

    source.onopen = () => setStreamState("open");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as RunProgressEvent;
        const key = runEventKey(event);
        if (!seenRef.current.has(key)) {
          seenRef.current.add(key);
          setEvents((current) => [...current, event]);
        }
        if (event.type === "done") {
          void queryClient.invalidateQueries({ queryKey: automationKeys.runStatus(runId) });
          void queryClient.invalidateQueries({ queryKey: automationKeys.runs() });
          closedByClient = true;
          source.close();
          setStreamState("closed");
        }
      } catch {
        setStreamState("unavailable");
        source.close();
      }
    };
    source.onerror = () => {
      if (!closedByClient) {
        setStreamState("unavailable");
        source.close();
      }
    };

    return () => {
      closedByClient = true;
      source.close();
    };
  }, [enabled, queryClient, runId]);

  return { events, streamState };
}

export function useReportSummary(runTimestamp: string | undefined) {
  return useQuery({
    queryKey: automationKeys.reportSummary(runTimestamp),
    queryFn: () => assessmentApi.getReportSummary(runTimestamp as string),
    enabled: !!runTimestamp,
  });
}

export function useRunResults(runTimestamp: string | undefined, enabled = true) {
  return useQuery({
    queryKey: automationKeys.runResults(runTimestamp),
    queryFn: () => assessmentApi.getReportSummary(runTimestamp as string),
    enabled: !!runTimestamp && enabled,
  });
}

export function useTestRunHistory(appExternalId: string | undefined, testId: string | undefined) {
  return useQuery({
    queryKey: automationKeys.testHistory(appExternalId, testId),
    enabled: !!appExternalId && !!testId,
    queryFn: () => assessmentApi.getTestHistory(appExternalId as string, testId as string),
  });
}

const PLAYBOOK_POLL_INTERVAL_MS = 45_000;

/** One run's structured static-analysis report, fetched through the evidence endpoint. */
export function useCriticalFindings(runTimestamp: string | undefined, ref: string | undefined) {
  return useQuery({
    queryKey: automationKeys.criticalFindings(runTimestamp, ref),
    queryFn: async () => {
      const response = await fetch(
        assessmentApi.evidenceFileUrl(runTimestamp as string, ref as string),
      );
      if (!response.ok) throw new Error(`Static analysis unavailable (${response.status})`);
      return parseCriticalFindings(await response.json());
    },
    enabled: !!runTimestamp && !!ref,
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    retry: false,
  });
}

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
    queryFn: () => playbookApi.getStatus(platform as AutomationPlatform),
    enabled: !!platform && enabled,
    retry: false,
    refetchInterval: enabled ? PLAYBOOK_POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: enabled,
  });

  const revision = status.data?.revision ?? null;

  useEffect(() => {
    if (!revision) return;
    if (initial.current === null) {
      initial.current = revision;
      return;
    }
    if (initial.current === revision) return;
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
      queryFn: () => playbookApi.listRiskControls(risk.platform, risk.riskId),
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
