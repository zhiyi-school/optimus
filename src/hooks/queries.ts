import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentApi, configApi, provisioningApi, syncApi, testApi } from "@/api/automation-services";
import type {
  AutomationPlatform,
  DashboardSyncStatus,
  RunProgressEvent,
} from "@/api/automation-types";
import { findActiveRun, findPlatformRun, type ActiveRunFilter } from "@/data/sync";
import { SYNC_STATUS_POLL_INTERVAL_MS, syncPollInterval } from "@/lib/dashboard-sync";
import { playbookApi } from "@/api/playbook-services";
import {
  activityData,
  applicationData,
  assessmentData,
  assessmentMessageData,
  attachmentData,
  controlProgressData,
  evidenceData,
  findingData,
  messageData,
  metricsData,
  retestData,
  riskAcceptanceData,
  teamData,
  ticketData,
  userData,
} from "@/data/services";
import type {
  ControlProgressStatus,
  FindingStatus,
  RiskAcceptanceDecision,
  TicketControl,
  TicketControlStep,
  TicketStatus,
  UserRole,
} from "@/data/types";
import type { ControlReconciliation, FindingFilters, TicketFilters } from "@/data/services";

export function useProfiles() {
  return useQuery({ queryKey: ["profiles"], queryFn: userData.listProfiles });
}

export function useTeams() {
  return useQuery({ queryKey: ["teams"], queryFn: teamData.list });
}

export function useApplications() {
  return useQuery({ queryKey: ["applications"], queryFn: applicationData.list });
}

export function useAssessments() {
  return useQuery({
    queryKey: ["assessments"],
    queryFn: assessmentData.listWithApplications,
  });
}

export function useAssessment(id: string | undefined) {
  return useQuery({
    queryKey: ["assessment", id],
    queryFn: () => assessmentData.getWithApplication(id as string),
    enabled: !!id,
  });
}

export function useRiskCatalogue(platform: AutomationPlatform | undefined) {
  return useQuery({
    queryKey: ["riskCatalogue", platform],
    queryFn: () => testApi.listRisks(platform as AutomationPlatform),
    enabled: !!platform,
  });
}

export function useConfiguredApps(platform: AutomationPlatform | undefined) {
  return useQuery({
    queryKey: ["configuredApps", platform],
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
    queryKey: ["appProvisioning", platform, appId],
    queryFn: () =>
      provisioningApi.getProvisioning(platform as AutomationPlatform, appId as string),
    enabled: !!platform && !!appId,
    refetchInterval: opts.poll ? PROVISIONING_POLL_INTERVAL_MS : false,
    retry: false,
  });
}

export function useAutomationRuns() {
  return useQuery({
    queryKey: ["automationRuns"],
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
    queryKey: ["automationRuns"],
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
    queryKey: ["automationReports"],
    queryFn: assessmentApi.listReports,
  });
}

export function useRunStatus(runId: string | undefined, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ["runStatus", runId],
    queryFn: () => assessmentApi.getRun(runId as string),
    enabled: !!runId,
    refetchInterval: (query) => {
      if (!opts.poll) return false;
      const status = query.state.data?.status;
      return status === "running" ? 2000 : false;
    },
  });
}

/** Supabase-backed views the worker rewrites when it publishes a run. */
const DASHBOARD_QUERY_KEYS = [
  "findings",
  "finding",
  "findingHistory",
  "findingRetests",
  "assessment",
  "assessments",
  "tickets",
  "ticket",
  "ticketsWithRelations",
  "ticketRetests",
  "activity",
  "dashboardMetrics",
];

export function useRunSyncStatus(runId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["runSyncStatus", runId],
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
    for (const key of DASHBOARD_QUERY_KEYS) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [status, queryClient]);

  return query;
}

export function useResyncRun(runId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => syncApi.resyncRun(runId as string),
    onSuccess: (data) => {
      queryClient.setQueryData(["runSyncStatus", runId], data);
    },
  });
}

export function useDashboardSyncWorker(opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ["dashboardSyncWorker"],
    queryFn: syncApi.getWorkerStatus,
    refetchInterval: opts.poll ? SYNC_STATUS_POLL_INTERVAL_MS : false,
    retry: false,
  });
}

export type RunEventStreamState = "idle" | "connecting" | "open" | "unavailable" | "closed";

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
          void queryClient.invalidateQueries({ queryKey: ["runStatus", runId] });
          void queryClient.invalidateQueries({ queryKey: ["automationRuns"] });
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
    queryKey: ["reportSummary", runTimestamp],
    queryFn: () => assessmentApi.getReportSummary(runTimestamp as string),
    enabled: !!runTimestamp,
  });
}

export function useRunResults(runTimestamp: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["runResults", runTimestamp],
    queryFn: () => assessmentApi.getReportSummary(runTimestamp as string),
    enabled: !!runTimestamp && enabled,
  });
}

export function useTestRunHistory(appExternalId: string | undefined, testId: string | undefined) {
  return useQuery({
    queryKey: ["testRunHistory", appExternalId, testId],
    enabled: !!appExternalId && !!testId,
    queryFn: () => assessmentApi.getTestHistory(appExternalId as string, testId as string),
  });
}

export function useFindings(filters: FindingFilters = {}) {
  return useQuery({
    queryKey: ["findings", filters],
    queryFn: () => findingData.listWithApplication(filters),
  });
}

export function useFinding(id: string | undefined) {
  return useQuery({
    queryKey: ["finding", id],
    queryFn: () => findingData.getWithApplication(id as string),
    enabled: !!id,
  });
}

export function useFindingHistory(findingId: string | undefined) {
  return useQuery({
    queryKey: ["findingHistory", findingId],
    queryFn: () => findingData.history(findingId as string),
    enabled: !!findingId,
  });
}

export function useFindingEvidence(findingId: string | undefined) {
  return useQuery({
    queryKey: ["findingEvidence", findingId],
    queryFn: () => evidenceData.listForFinding(findingId as string),
    enabled: !!findingId,
  });
}

export function useFindingEvidenceItems(findingId: string | undefined) {
  return useQuery({
    queryKey: ["findingEvidenceItems", findingId],
    queryFn: async () => {
      const rows = await evidenceData.listForFinding(findingId as string);
      return Promise.all(
        rows.map(async (row) => {
          let url: string | undefined;
          if (row.storage_path) {
            const { data } = await evidenceData.getSignedUrl(row.storage_path);
            url = data?.signedUrl;
          } else if (row.external_url) {
            url = row.external_url;
          }
          return {
            id: row.id,
            name: row.name,
            kind: row.type,
            url,
            textContent: row.text_content,
            source: row.source,
          };
        }),
      );
    },
    enabled: !!findingId,
  });
}

export function useTicketEvidenceItems(ticketId: string | undefined) {
  return useQuery({
    queryKey: ["ticketEvidenceItems", ticketId],
    queryFn: async () => {
      const rows = await evidenceData.listForTicket(ticketId as string);
      return Promise.all(
        rows.map(async (row) => {
          let url: string | undefined;
          if (row.storage_path) {
            const { data } = await evidenceData.getSignedUrl(row.storage_path);
            url = data?.signedUrl;
          } else if (row.external_url) {
            url = row.external_url;
          }
          return {
            id: row.id,
            name: row.name,
            kind: row.type,
            url,
            textContent: row.text_content,
            source: row.source,
          };
        }),
      );
    },
    enabled: !!ticketId,
  });
}

export function useUploadTicketEvidence(ticketId: string | undefined) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (file: File) => evidenceData.uploadFile(null, ticketId as string, file),
    onSuccess: () =>
      invalidate([
        ["ticketEvidenceItems", ticketId],
        ["activity", "ticket", ticketId],
      ]),
  });
}

export function useFindingRetests(findingId: string | undefined) {
  return useQuery({
    queryKey: ["findingRetests", findingId],
    queryFn: () => retestData.listForFinding(findingId as string),
    enabled: !!findingId,
  });
}

export function useFindingTickets(findingId: string | undefined) {
  return useQuery({
    queryKey: ["tickets", { findingId }],
    queryFn: () => ticketData.list({ findingId }),
    enabled: !!findingId,
  });
}

export function useTicketsByFindingIds(findingIds: string[]) {
  return useQuery({
    queryKey: ["ticketsByFindingIds", findingIds],
    queryFn: () => ticketData.listByFindingIds(findingIds),
    enabled: findingIds.length > 0,
  });
}

export function useTickets(filters: TicketFilters = {}) {
  return useQuery({
    queryKey: ["ticketsWithRelations", filters],
    queryFn: () => ticketData.listWithRelations(filters),
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: ["ticket", id],
    queryFn: () => ticketData.getWithRelations(id as string),
    enabled: !!id,
  });
}

export function useTicketMessages(ticketId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["ticketMessages", ticketId],
    queryFn: () => messageData.listForTicket(ticketId as string),
    enabled: !!ticketId,
  });

  useEffect(() => {
    if (!ticketId) return;
    return messageData.subscribeToTicket(ticketId, () => {
      void queryClient.invalidateQueries({ queryKey: ["ticketMessages", ticketId] });
    });
  }, [ticketId, queryClient]);

  return query;
}

export function useAssessmentMessages(assessmentId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["assessmentMessages", assessmentId],
    queryFn: () => assessmentMessageData.listForAssessment(assessmentId as string),
    enabled: !!assessmentId,
  });

  useEffect(() => {
    if (!assessmentId) return;
    return assessmentMessageData.subscribeToAssessment(assessmentId, () => {
      void queryClient.invalidateQueries({ queryKey: ["assessmentMessages", assessmentId] });
    });
  }, [assessmentId, queryClient]);

  return query;
}

export function useSendAssessmentMessage(assessmentId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (message: string) => assessmentMessageData.send(assessmentId, message),
    onSuccess: () =>
      invalidate([
        ["assessmentMessages", assessmentId],
        ["activity", "assessment", assessmentId],
      ]),
  });
}

export function useTicketRetests(ticketId: string | undefined) {
  return useQuery({
    queryKey: ["ticketRetests", ticketId],
    queryFn: () => retestData.listForTicket(ticketId as string),
    enabled: !!ticketId,
  });
}

export function useTicketAttachments(ticketId: string | undefined) {
  return useQuery({
    queryKey: ["ticketAttachments", ticketId],
    queryFn: () => attachmentData.listForTicket(ticketId as string),
    enabled: !!ticketId,
  });
}

export function useRiskAcceptance(ticketId: string | undefined) {
  return useQuery({
    queryKey: ["riskAcceptance", ticketId],
    queryFn: () => riskAcceptanceData.getForTicket(ticketId as string),
    enabled: !!ticketId,
  });
}

export function usePendingRiskAcceptance() {
  return useQuery({
    queryKey: ["riskAcceptancePending"],
    queryFn: riskAcceptanceData.listPending,
  });
}

export function useActivity(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: ["activity", entityType, entityId],
    queryFn: () => activityData.listForEntity(entityType, entityId as string),
    enabled: !!entityId,
  });
}

export function useDashboardMetrics() {
  return useQuery({ queryKey: ["dashboardMetrics"], queryFn: metricsData.getOverview });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return (keys: readonly unknown[][]) =>
    Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
}

export function useCreateRemediationTicket() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ticketData.createRemediationTicket,
    onSuccess: (_data, variables) =>
      invalidate([
        ["ticketsWithRelations"],
        ["tickets", { findingId: variables.finding_id }],
        ["dashboardMetrics"],
      ]),
  });
}

const TICKET_LIFECYCLE_KEYS = (ticketId: string, findingId: string | null | undefined) => [
  ["ticket", ticketId],
  ["ticketsWithRelations"],
  ["tickets"],
  ["activity", "ticket", ticketId],
  ["dashboardMetrics"],
  ...(findingId ? [["finding", findingId], ["activity", "finding", findingId]] : []),
];

export function useStartRemediation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: {
      ticket: Parameters<typeof ticketData.createRemediationTicket>[0];
      plan: ControlReconciliation[];
    }) => {
      const ticket = await ticketData.createRemediationTicket(input.ticket);
      if (input.plan.length > 0) {
        await controlProgressData.reconcile(ticket.id, input.plan);
      }
      return ticket;
    },
    onSuccess: (ticket) => invalidate(TICKET_LIFECYCLE_KEYS(ticket.id, ticket.finding_id)),
  });
}

export function useWithdrawTicket(ticketId: string, findingId: string | null | undefined) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (reason: string) => ticketData.withdraw(ticketId, reason),
    onSuccess: () => invalidate(TICKET_LIFECYCLE_KEYS(ticketId, findingId)),
  });
}

export function useResumeTicket(ticketId: string, findingId: string | null | undefined) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => ticketData.resume(ticketId),
    onSuccess: () => invalidate(TICKET_LIFECYCLE_KEYS(ticketId, findingId)),
  });
}

export function useCreateRiskAcceptanceTicket() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ticketData.createRiskAcceptanceTicket,
    onSuccess: (_data, variables) =>
      invalidate([
        ["ticketsWithRelations"],
        ["tickets", { findingId: variables.finding_id }],
        ["dashboardMetrics"],
      ]),
  });
}

export function useSendMessage(ticketId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (message: string) => messageData.send(ticketId, message),
    onSuccess: () => invalidate([["ticketMessages", ticketId], ["activity", "ticket", ticketId]]),
  });
}

export function useUploadAttachment(ticketId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (file: File) => attachmentData.upload(ticketId, file),
    onSuccess: () =>
      invalidate([["ticketAttachments", ticketId], ["activity", "ticket", ticketId]]),
  });
}

export function useSubmitFix(ticketId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { notes: string; target_version?: string }) =>
      ticketData.submitFix(ticketId, input),
    onSuccess: () =>
      invalidate([
        ["ticket", ticketId],
        ["ticketsWithRelations"],
        ["ticketMessages", ticketId],
        ["tickets"],
        ["activity", "ticket", ticketId],
        ["dashboardMetrics"],
      ]),
  });
}

export function useUpdateTicketStatus(ticketId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (status: TicketStatus) => ticketData.updateStatus(ticketId, status),
    onSuccess: () =>
      invalidate([
        ["ticket", ticketId],
        ["ticketsWithRelations"],
        ["tickets"],
        ["activity", "ticket", ticketId],
        ["dashboardMetrics"],
      ]),
  });
}

export function useRequestRetest(ticketId: string, findingId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => retestData.requestRetest(ticketId, findingId),
    onSuccess: () =>
      invalidate([
        ["ticket", ticketId],
        ["ticketsWithRelations"],
        ["tickets"],
        ["findingRetests", findingId],
        ["activity", "ticket", ticketId],
        ["dashboardMetrics"],
      ]),
  });
}

export function useUpdateFindingStatus(findingId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { status: FindingStatus; reason?: string }) =>
      findingData.updateStatus(findingId, input.status, input.reason),
    onSuccess: () =>
      invalidate([
        ["finding", findingId],
        ["findingHistory", findingId],
        ["findings"],
        ["dashboardMetrics"],
      ]),
  });
}

export function useReviewRiskAcceptance() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      ticketId: string;
      decision: RiskAcceptanceDecision;
      comment?: string;
    }) => riskAcceptanceData.review(id, decision, comment),
    onSuccess: (_data, variables) =>
      invalidate([
        ["ticket", variables.ticketId],
        ["ticketsWithRelations"],
        ["riskAcceptance", variables.ticketId],
        ["riskAcceptancePending"],
        ["dashboardMetrics"],
      ]),
  });
}


export function useRiskControls(
  platform: AutomationPlatform | undefined,
  riskId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["riskControls", platform, riskId],
    queryFn: () => playbookApi.listRiskControls(platform as AutomationPlatform, riskId as string),
    enabled: !!platform && !!riskId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useControlDetail(
  platform: AutomationPlatform | undefined,
  controlId: string | undefined,
) {
  return useQuery({
    queryKey: ["control", platform, controlId],
    queryFn: () => playbookApi.getControl(platform as AutomationPlatform, controlId as string),
    enabled: !!platform && !!controlId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useControlSource(
  platform: AutomationPlatform | undefined,
  controlId: string | undefined,
) {
  return useQuery({
    queryKey: ["controlSource", platform, controlId],
    queryFn: () => playbookApi.getControlSource(platform as AutomationPlatform, controlId as string),
    enabled: !!platform && !!controlId,
    retry: false,
  });
}

export function useTicketControls(ticketId: string | undefined) {
  return useQuery({
    queryKey: ["ticketControls", ticketId],
    queryFn: () => controlProgressData.listForTicket(ticketId as string),
    enabled: !!ticketId,
  });
}

export function useTicketControlSteps(ticketId: string | undefined) {
  return useQuery({
    queryKey: ["ticketControlSteps", ticketId],
    queryFn: () => controlProgressData.listStepsForTicket(ticketId as string),
    enabled: !!ticketId,
  });
}

export function useControlProgressForTickets(ticketIds: string[]) {
  const key = [...ticketIds].sort();
  const controls = useQuery({
    queryKey: ["ticketControlsBulk", key],
    queryFn: () => controlProgressData.listForTicketIds(key),
    enabled: key.length > 0,
  });

  const controlRowIds = (controls.data ?? []).map((control) => control.id).sort();
  const steps = useQuery({
    queryKey: ["ticketControlStepsBulk", controlRowIds],
    queryFn: () => controlProgressData.listStepsForControlIds(controlRowIds),
    enabled: controlRowIds.length > 0,
  });

  return {
    controls: controls.data ?? EMPTY_CONTROLS,
    steps: steps.data ?? EMPTY_STEPS,
    isLoading: controls.isLoading || steps.isLoading,
    isError: controls.isError || steps.isError,
  };
}

const EMPTY_CONTROLS: TicketControl[] = [];
const EMPTY_STEPS: TicketControlStep[] = [];

const CONTROL_PROGRESS_KEYS = (ticketId: string) => [
  ["ticketControls", ticketId],
  ["ticketControlSteps", ticketId],
  ["ticketControlsBulk"],
  ["activity", "ticket", ticketId],
];

export function useReconcileTicketControls(ticketId: string | undefined) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (plan: ControlReconciliation[]) =>
      controlProgressData.reconcile(ticketId as string, plan),
    onSuccess: () => invalidate(CONTROL_PROGRESS_KEYS(ticketId as string)),
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
    queryKey: ["playbookStatus", platform],
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
    void queryClient.invalidateQueries({ queryKey: ["riskControls"] });
    void queryClient.invalidateQueries({ queryKey: ["control"] });
    void queryClient.invalidateQueries({ queryKey: ["controlSource"] });
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
      queryKey: ["riskControls", risk.platform, risk.riskId],
      queryFn: () => playbookApi.listRiskControls(risk.platform, risk.riskId),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });

  return useMemo(() => {
    if (results.length === 0 || results.some((result) => !result.isSuccess)) return undefined;
    const controlIds = new Set<string>();
    const stepKeys = new Set<string>();
    for (const result of results) {
      for (const control of result.data ?? []) {
        controlIds.add(control.control_id);
        for (const step of control.steps) stepKeys.add(step.step_key);
      }
    }
    return { controlIds, stepKeys };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => `${r.status}:${r.dataUpdatedAt}`).join("|")]);
}

export function useSetControlStepStatus(ticketId: string | undefined) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { stepId: string; status: ControlProgressStatus; note?: string }) =>
      controlProgressData.setStepStatus(
        ticketId as string,
        input.stepId,
        input.status,
        input.note,
      ),
    onSuccess: () => invalidate(CONTROL_PROGRESS_KEYS(ticketId as string)),
  });
}

export function useSetControlStatus(ticketId: string | undefined) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      controlRowId: string;
      status: ControlProgressStatus;
      note?: string;
    }) =>
      controlProgressData.setControlStatus(
        ticketId as string,
        input.controlRowId,
        input.status,
        input.note,
      ),
    onSuccess: () => invalidate(CONTROL_PROGRESS_KEYS(ticketId as string)),
  });
}

export function useCreateTeam() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: teamData.create,
    onSuccess: () => invalidate([["teams"]]),
  });
}

export function useUpdateProfileTeam() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ profileId, teamId }: { profileId: string; teamId: string | null }) =>
      userData.updateTeam(profileId, teamId),
    onSuccess: () => invalidate([["profiles"]]),
  });
}

export function useUpdateProfileRoles() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ profileId, roles }: { profileId: string; roles: UserRole[] }) =>
      userData.updateRoles(profileId, roles),
    onSuccess: () => invalidate([["profiles"]]),
  });
}

export function useSetUserActive() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ profileId, isActive }: { profileId: string; isActive: boolean }) =>
      userData.setActive(profileId, isActive),
    onSuccess: () => invalidate([["profiles"]]),
  });
}

export function useUpdateApplication() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ applicationId, patch }: { applicationId: string; patch: Parameters<typeof applicationData.update>[1] }) =>
      applicationData.update(applicationId, patch),
    onSuccess: () =>
      invalidate([["applications"], ["assessments"], ["findings"], ["dashboardMetrics"]]),
  });
}

export function useDeleteApplication() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ applicationId, applicationName }: { applicationId: string; applicationName: string }) =>
      applicationData.remove(applicationId, applicationName),
    onSuccess: () =>
      invalidate([
        ["applications"],
        ["assessments"],
        ["findings"],
        ["ticketsWithRelations"],
        ["dashboardMetrics"],
      ]),
  });
}
