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
  /** Both added by the backend on read; `exists` is false when the file is missing. */
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
  /** MITRE ATT&CK Mobile tactic, or null where the risk isn't mapped to one. */
  tactic: string | null;
  /** False for risks that can only be tested by hand. */
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

/** Body for POST /config/{platform}/apps. */
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

/** GET /config/{platform}/apps/{app_id}/provisioning. */
export interface AppProvisioning {
  app_id: string;
  platform: AutomationPlatform;
  /** Resolved by the backend from the matched build; null until one is found. */
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
