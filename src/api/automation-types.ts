export type AutomationPlatform = "ios" | "android";

export type RunStatus = "running" | "completed" | "failed";

export interface RunRecord {
  run_id: string;
  platform: AutomationPlatform;
  config_path: string;
  status: RunStatus;
  run_timestamp: string;
  run_dir: string;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  /** CSV selection the run was started with; `null` means every app / every risk. */
  apps: string | null;
  risks: string | null;
}

/** SARIF 2.1.0 — an interoperability export, never the dashboard's input. */
export interface SarifDocument {
  version: string;
  $schema: string;
  runs: SarifRun[];
}

export interface SarifRun {
  tool: { driver: { name: string; version: string; rules: SarifRule[] } };
  automationDetails?: { id: string };
  invocations?: { executionSuccessful: boolean }[];
  results: SarifResult[];
  properties?: Record<string, unknown>;
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription?: { text: string };
  fullDescription?: { text: string };
  properties?: Record<string, unknown>;
}

export interface SarifResult {
  ruleId: string;
  ruleIndex?: number;
  kind: "pass" | "fail" | "review" | "open" | "notApplicable" | "informational";
  level: "none" | "note" | "warning" | "error";
  message: { text: string };
  partialFingerprints?: Record<string, string>;
  properties?: Record<string, unknown>;
}

/** The dashboard sync workflow, which runs after — and separately from — the automation run. */
export type DashboardSyncStatus = "queued" | "running" | "completed" | "failed" | "not_required";

export interface RunSyncCounts {
  applications: number;
  assessments: number;
  findings: number;
  history: number;
  activity: number;
}

export interface RunSyncStatus {
  run_id: string;
  run_timestamp: string;
  status: DashboardSyncStatus;
  attempt: number;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_updated_at: string | null;
  error: string | null;
  retryable: boolean;
  counts: RunSyncCounts;
}

export interface DashboardSyncWorkerStatus {
  enabled: boolean;
  worker_state: "idle" | "running";
  queue_depth: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  recovery_sweep_enabled: boolean;
}

export interface RunProgressEvent {
  type: string;
  timestamp?: string;
  app_id?: string;
  risk_id?: string;
  test_case_id?: string;
  verdict?: RiskVerdict | string;
  final_status?: string;
  message?: string;
  status?: RunStatus;
  error?: string | null;
  [key: string]: unknown;
}

export interface StartRunRequest {
  platform: AutomationPlatform;
  config_path: string;
  apps?: string;
  risks?: string;
  out_dir?: string;
}

export interface DemonstrationImage {
  path: string;
  caption?: string;
  url?: string;
  exists?: boolean;
}

export interface DemonstrationStep {
  id: string;
  text: string;
  images?: DemonstrationImage[];
  commands?: string[];
}

export interface DemonstrationStepsBlock {
  id: string;
  type: "steps";
  label?: string;
  items: DemonstrationStep[];
}

export interface DemonstrationTableBlock {
  id: string;
  type: "table";
  label?: string;
  rows: Record<string, string>[];
}

export type DemonstrationBlock = DemonstrationTableBlock | DemonstrationStepsBlock;

export interface RiskDefinition {
  risk_id: string;
  name: string;
  description: string;
  goal: string;
  is_blocking: boolean;
  tactic: string | null;
  automation_available?: boolean;
  demonstration: DemonstrationBlock[];
  [key: string]: unknown;
}

export interface FeatureDefinition {
  feature_id: string;
  name: string;
  description: string;
}

export interface AppConfigEntry {
  id: string;
  name: string;
  bundle_id?: string;
  package_name?: string;
  [key: string]: unknown;
}

export interface RegisterAppRequest {
  id?: string;
  name: string;
  version?: string;
  bundle_id?: string;
  package_name?: string;
  artifact?: {
    source: "intake_ipa" | "local_ipa" | "installed_app_reference";
    ipa?: string;
    expected_bundle_id?: string;
  };
  risks?: Record<string, { enabled: boolean }>;
}

export type ProvisioningStageState = "pending" | "in_progress" | "done" | "failed" | "unknown";

export interface ProvisioningStage {
  id: string;
  label: string;
  state: ProvisioningStageState;
  detail?: string | null;
}

export interface AppProvisioning {
  app_id: string;
  platform: AutomationPlatform;
  bundle_id: string | null;
  status: "pending" | "ready" | "failed";
  stages: ProvisioningStage[];
  error?: string | null;
}

export interface EvidenceRef {
  kind: string;
  label: string;
  path: string;
}

export interface AutomationResultRow {
  app_id: string;
  app_name: string;
  platform: AutomationPlatform;
  package_or_bundle_id: string;
  test_id: string;
  test_name: string;
  category: string;
  status: string;
  verdict: RiskVerdict;
  severity: string | null;
  summary: string;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
  evidence: EvidenceRef[];
  report_path: string;
  run_timestamp: string;
  raw: Record<string, unknown>;
}

export type RiskVerdict = "At Risk" | "Reduced Risk" | "Inconclusive";

export interface RiskReportDetail {
  app_id: string;
  risk_id: string;
  test_case_id: string;
  final_status: string;
  verdict: RiskVerdict;
  [key: string]: unknown;
}

export interface ConfigValidationError {
  field?: string;
  message: string;
}

export interface ApiErrorBody {
  detail?: string | ConfigValidationError[];
}
