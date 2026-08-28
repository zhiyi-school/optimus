import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentApi, configApi, provisioningApi, testApi } from "@/api/automation-services";
import type { AutomationPlatform } from "@/api/automation-types";
import {
  activityData,
  applicationData,
  assessmentData,
  assessmentMessageData,
  attachmentData,
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
import { syncService } from "@/data/sync";
import type {
  FindingStatus,
  RiskAcceptanceDecision,
  TicketStatus,
  UserRole,
} from "@/data/types";
import type { FindingFilters, TicketFilters } from "@/data/services";

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
      ]),
  });
}

export function useUpdateTicketStatus(ticketId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (status: TicketStatus) => ticketData.updateStatus(ticketId, status),
    onSuccess: () =>
      invalidate([["ticket", ticketId], ["ticketsWithRelations"], ["dashboardMetrics"]]),
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
        ["findingRetests", findingId],
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

export function useSyncReport() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      runTimestamp,
      triggeredBy,
    }: {
      runTimestamp: string;
      triggeredBy: string | null;
    }) => syncService.syncReport(runTimestamp, triggeredBy),
    onSuccess: () =>
      invalidate([
        ["assessments"],
        ["applications"],
        ["findings"],
        ["dashboardMetrics"],
      ]),
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
