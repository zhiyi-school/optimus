/**
 * Query key factories for each dashboard data domain.
 */

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
  /** Key for an assessment's automation run request. */
  runRequest: (id: string | undefined) => ["assessmentRunRequest", id] as const,
};

export const automationKeys = {
  /** Key for automation runs. */
  runs: () => ["automationRuns"] as const,
  /** Key for automation reports. */
  reports: () => ["automationReports"] as const,
  /** Key for one run's execution status. */
  runStatus: (id: string | undefined) => ["runStatus", id] as const,
  /** Key for one run's dashboard sync status. */
  runSyncStatus: (id: string | undefined) => ["runSyncStatus", id] as const,
  /** Key for the dashboard sync worker status. */
  syncWorker: () => ["dashboardSyncWorker"] as const,
  /** Key for a platform's risk catalogue. */
  riskCatalogue: (platform: string | undefined) => ["riskCatalogue", platform] as const,
  /** Key for a platform's configured apps. */
  configuredApps: (platform: string | undefined) => ["configuredApps", platform] as const,
  /** Key for an app's provisioning state on a platform. */
  provisioning: (platform: string | undefined, appId: string | null | undefined) =>
    ["appProvisioning", platform, appId] as const,
  /** Key for a report's summary. */
  reportSummary: (timestamp: string | undefined) => ["reportSummary", timestamp] as const,
  /** Key for a report's run results. */
  runResults: (timestamp: string | undefined) => ["runResults", timestamp] as const,
  /** Key for one test's run history on an app. */
  testHistory: (appId: string | undefined, testId: string | undefined) =>
    ["testRunHistory", appId, testId] as const,
  /** Key for an IPA analysis within a report. */
  ipaAnalysis: (timestamp: string | undefined, ref: string | undefined) =>
    ["ipaAnalysis", timestamp, ref] as const,
  /** Key for a platform's playbook status. */
  playbookStatus: (platform: string | undefined) => ["playbookStatus", platform] as const,
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
  /** Key for one conversation by ID. */
  detail: (id: string | null | undefined) => ["riskConversationById", id] as const,
  /** Key for a conversation's entries. */
  entries: (id?: string) => ["riskConversationEntries", id] as const,
  /** Prefix matching every conversation entries key. */
  entriesPrefix: () => ["riskConversationEntries"] as const,
  /** Key for attachments of the given entries, or the prefix for all attachments. */
  attachments: (entryIds?: string[]) =>
    entryIds ? (["riskConversationAttachments", entryIds] as const) : (["riskConversationAttachments"] as const),
};

export const evidenceKeys = {
  /** Key for findings matching the filters, or the prefix for all findings. */
  findings: (filters?: unknown) => filters === undefined ? (["findings"] as const) : (["findings", filters] as const),
  /** Key for one finding. */
  finding: (id?: string) => ["finding", id] as const,
  /** Key for a finding's history. */
  findingHistory: (id?: string) => ["findingHistory", id] as const,
  /** Key for a finding's evidence. */
  findingEvidence: (id?: string) => ["findingEvidence", id] as const,
  /** Key for a finding's evidence items. */
  findingItems: (id?: string) => ["findingEvidenceItems", id] as const,
  /** Key for a ticket's evidence items. */
  ticketItems: (id?: string) => ["ticketEvidenceItems", id] as const,
};

export const ticketKeys = {
  /** Key for tickets linked to a finding. */
  byFinding: (findingId?: string) => ["tickets", { findingId }] as const,
  /** Prefix matching every ticket list key. */
  listPrefix: () => ["tickets"] as const,
  /** Key for tickets linked to any of the given findings. */
  byFindingIds: (ids: string[]) => ["ticketsByFindingIds", ids] as const,
  /** Key for tickets with relations matching the filters, or the prefix for all. */
  withRelations: (filters?: unknown) =>
    filters === undefined ? (["ticketsWithRelations"] as const) : (["ticketsWithRelations", filters] as const),
  /** Key for one ticket. */
  detail: (id?: string) => ["ticket", id] as const,
  /** Key for a ticket's risk acceptance. */
  acceptance: (id?: string) => ["riskAcceptance", id] as const,
  /** Key for pending risk acceptances. */
  pendingAcceptance: () => ["riskAcceptancePending"] as const,
  /** Key for the activity of an entity. */
  activity: (type: string, id?: string) => ["activity", type, id] as const,
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
};
