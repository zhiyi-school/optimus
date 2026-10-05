/**
 * Query key factories for each dashboard data domain.
 */

import type { ReportFilters } from "@/automation-api/types";

export const referenceKeys = {
  /** Key for all user profiles. */
  profiles: () => ["profiles"] as const,
  /** Key for all teams. */
  teams: () => ["teams"] as const,
  /** Key for all applications. */
  applications: () => ["applications"] as const,
};

export const assessmentKeys = {
  /** Key for the assessment list. */
  all: () => ["assessments"] as const,
  /** Key for one assessment. */
  detail: (id: string | undefined) => ["assessment", id] as const,
  /** Prefix matching every assessment detail key. */
  detailPrefix: () => ["assessment"] as const,
  /** Key for an assessment's automation run request. */
  runRequest: (id: string | undefined) => ["assessmentRunRequest", id] as const,
  /** Prefix matching every assessment run request key. */
  runRequestPrefix: () => ["assessmentRunRequest"] as const,
};

export const automationKeys = {
  /** Key for automation runs. */
  runs: () => ["automationRuns"] as const,
  /** Key for automation reports matching the filters. */
  reports: (filters: ReportFilters = {}) =>
    ["automationReports", filters.status ?? null, filters.syncStatus?.join(",") ?? null] as const,
  /** Prefix matching every automation reports key. */
  reportsPrefix: () => ["automationReports"] as const,
  /** Key for one run's execution status. */
  runStatus: (id: string | undefined) => ["runStatus", id] as const,
  /** Key for one run's dashboard sync status. */
  runSyncStatus: (id: string | undefined) => ["runSyncStatus", id] as const,
  /** Key for a platform's risk catalogue. */
  riskCatalogue: (platform: string | undefined) => ["riskCatalogue", platform] as const,
  /** Key for an app's provisioning state on a platform. */
  provisioning: (platform: string | undefined, appId: string | null | undefined) =>
    ["appProvisioning", platform, appId] as const,
  /** Key for an iOS app's intake builds. */
  builds: (platform: string | undefined, appId: string | null | undefined) =>
    ["appBuilds", platform, appId] as const,
  /** Key for a report's run results. */
  runResults: (timestamp: string | undefined) => ["runResults", timestamp] as const,
  /** Key for one test's run history on an app. */
  testHistory: (appId: string | undefined, testId: string | undefined) =>
    ["testRunHistory", appId, testId] as const,
  /** Prefix matching every test run history key. */
  testHistoryPrefix: () => ["testRunHistory"] as const,
  /** Key for an IPA analysis within a report. */
  ipaAnalysis: (timestamp: string | undefined, ref: string | undefined) =>
    ["ipaAnalysis", timestamp, ref] as const,
};

export const playbookKeys = {
  /** Key for a platform's playbook status. */
  status: (platform: string | undefined) => ["playbookStatus", platform] as const,
  /** Key for the controls that mitigate a risk. */
  riskControls: (platform?: string, riskId?: string | null) =>
    ["riskControls", platform, riskId] as const,
  /** Prefix matching every risk controls key. */
  riskControlsPrefix: () => ["riskControls"] as const,
  /** Key for one control definition. */
  control: (platform?: string, controlId?: string) => ["control", platform, controlId] as const,
  /** Prefix matching every control key. */
  controlPrefix: () => ["control"] as const,
  /** Key for a control's playbook source. */
  controlSource: (platform?: string, controlId?: string) =>
    ["controlSource", platform, controlId] as const,
  /** Prefix matching every control source key. */
  controlSourcePrefix: () => ["controlSource"] as const,
};

export const conversationKeys = {
  /** Key for the conversation of a risk, optionally created on read. */
  byRisk: (
    applicationId: string | undefined,
    riskId: string | undefined,
    findingId: string | null | undefined,
    create: boolean,
  ) => ["riskConversation", applicationId, riskId, findingId ?? null, create] as const,
  /** Prefix matching every risk conversation key. */
  byRiskPrefix: () => ["riskConversation"] as const,
  /** Key for a conversation's entries. */
  entries: (id?: string) => ["riskConversationEntries", id] as const,
  /** Prefix matching every conversation entries key. */
  entriesPrefix: () => ["riskConversationEntries"] as const,
  /** Key for the newest conversation entry time of every visible application. */
  activity: () => ["riskConversationActivity"] as const,
  /** Key for attachments of the given entries, or the prefix for all attachments. */
  attachments: (entryIds?: string[]) =>
    entryIds ? (["riskConversationAttachments", entryIds] as const) : (["riskConversationAttachments"] as const),
};

export const evidenceKeys = {
  /** Key for findings matching the filters, or the prefix for all findings. */
  findings: (filters?: unknown) => filters === undefined ? (["findings"] as const) : (["findings", filters] as const),
  /** Key for one finding. */
  finding: (id?: string) => ["finding", id] as const,
  /** Prefix matching every finding detail key. */
  findingPrefix: () => ["finding"] as const,
  /** Key for a finding's evidence items. */
  findingItems: (id?: string) => ["findingEvidenceItems", id] as const,
};

export const ticketKeys = {
  /** Key for tickets linked to a finding. */
  byFinding: (findingId?: string) => ["tickets", { findingId }] as const,
  /** Prefix matching every ticket list key. */
  listPrefix: () => ["tickets"] as const,
  /** Key for tickets with relations matching the filters, or the prefix for all. */
  withRelations: (filters?: unknown) =>
    filters === undefined ? (["ticketsWithRelations"] as const) : (["ticketsWithRelations", filters] as const),
  /** Key for one ticket. */
  detail: (id?: string) => ["ticket", id] as const,
  /** Prefix matching every ticket detail key. */
  detailPrefix: () => ["ticket"] as const,
  /** Key for dashboard metrics. */
  metrics: () => ["dashboardMetrics"] as const,
  /** Key for a ticket's control progress. */
  controls: (id?: string) => ["ticketControls", id] as const,
  /** Key for a ticket's control step progress. */
  controlSteps: (id?: string) => ["ticketControlSteps", id] as const,
  /** Key for control progress of the given tickets, or the prefix for all. */
  controlsBulk: (ids?: string[]) => ids ? (["ticketControlsBulk", ids] as const) : (["ticketControlsBulk"] as const),
  /** Key for control step progress of the given tickets. */
  controlStepsBulk: (ids: string[]) => ["ticketControlStepsBulk", ids] as const,
  /** Key for a finding's retest runs. */
  findingRetests: (id?: string) => ["findingRetests", id] as const,
  /** Prefix matching every finding retests key. */
  findingRetestsPrefix: () => ["findingRetests"] as const,
};

export const riskAcceptanceKeys = {
  /** Key for the acceptance in force for a finding. */
  activeForFinding: (findingId?: string) => ["riskAcceptance", findingId] as const,
  /** Prefix matching every risk acceptance key. */
  prefix: () => ["riskAcceptance"] as const,
};
