export const referenceKeys = {
  profiles: () => ["profiles"] as const,
  teams: () => ["teams"] as const,
  applications: () => ["applications"] as const,
};

export const assessmentKeys = {
  all: () => ["assessments"] as const,
  detail: (id: string | undefined) => ["assessment", id] as const,
  runRequest: (id: string | undefined) => ["assessmentRunRequest", id] as const,
};

export const automationKeys = {
  runs: () => ["automationRuns"] as const,
  reports: () => ["automationReports"] as const,
  runStatus: (id: string | undefined) => ["runStatus", id] as const,
  runSyncStatus: (id: string | undefined) => ["runSyncStatus", id] as const,
  syncWorker: () => ["dashboardSyncWorker"] as const,
  riskCatalogue: (platform: string | undefined) => ["riskCatalogue", platform] as const,
  configuredApps: (platform: string | undefined) => ["configuredApps", platform] as const,
  provisioning: (platform: string | undefined, appId: string | null | undefined) =>
    ["appProvisioning", platform, appId] as const,
  reportSummary: (timestamp: string | undefined) => ["reportSummary", timestamp] as const,
  runResults: (timestamp: string | undefined) => ["runResults", timestamp] as const,
  testHistory: (appId: string | undefined, testId: string | undefined) =>
    ["testRunHistory", appId, testId] as const,
  criticalFindings: (timestamp: string | undefined, ref: string | undefined) =>
    ["criticalFindings", timestamp, ref] as const,
  playbookStatus: (platform: string | undefined) => ["playbookStatus", platform] as const,
  riskControls: (platform?: string, riskId?: string | null) =>
    ["riskControls", platform, riskId] as const,
  riskControlsPrefix: () => ["riskControls"] as const,
  control: (platform?: string, controlId?: string) => ["control", platform, controlId] as const,
  controlPrefix: () => ["control"] as const,
  controlSource: (platform?: string, controlId?: string) =>
    ["controlSource", platform, controlId] as const,
  controlSourcePrefix: () => ["controlSource"] as const,
};

export const conversationKeys = {
  byRisk: (
    applicationId: string | undefined,
    riskId: string | undefined,
    findingId: string | null | undefined,
    create: boolean,
  ) => ["riskConversation", applicationId, riskId, findingId ?? null, create] as const,
  detail: (id: string | null | undefined) => ["riskConversationById", id] as const,
  entries: (id?: string) => ["riskConversationEntries", id] as const,
  entriesPrefix: () => ["riskConversationEntries"] as const,
  attachments: (entryIds?: string[]) =>
    entryIds ? (["riskConversationAttachments", entryIds] as const) : (["riskConversationAttachments"] as const),
};

export const evidenceKeys = {
  findings: (filters?: unknown) => filters === undefined ? (["findings"] as const) : (["findings", filters] as const),
  finding: (id?: string) => ["finding", id] as const,
  findingHistory: (id?: string) => ["findingHistory", id] as const,
  findingEvidence: (id?: string) => ["findingEvidence", id] as const,
  findingItems: (id?: string) => ["findingEvidenceItems", id] as const,
  ticketItems: (id?: string) => ["ticketEvidenceItems", id] as const,
};

export const ticketKeys = {
  byFinding: (findingId?: string) => ["tickets", { findingId }] as const,
  listPrefix: () => ["tickets"] as const,
  byFindingIds: (ids: string[]) => ["ticketsByFindingIds", ids] as const,
  withRelations: (filters?: unknown) =>
    filters === undefined ? (["ticketsWithRelations"] as const) : (["ticketsWithRelations", filters] as const),
  detail: (id?: string) => ["ticket", id] as const,
  acceptance: (id?: string) => ["riskAcceptance", id] as const,
  pendingAcceptance: () => ["riskAcceptancePending"] as const,
  activity: (type: string, id?: string) => ["activity", type, id] as const,
  metrics: () => ["dashboardMetrics"] as const,
  controls: (id?: string) => ["ticketControls", id] as const,
  controlSteps: (id?: string) => ["ticketControlSteps", id] as const,
  controlsBulk: (ids?: string[]) => ids ? (["ticketControlsBulk", ids] as const) : (["ticketControlsBulk"] as const),
  controlStepsBulk: (ids: string[]) => ["ticketControlStepsBulk", ids] as const,
  findingRetests: (id?: string) => ["findingRetests", id] as const,
};
