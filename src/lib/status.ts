import type {
  Assessment,
  AssessmentRunRequest,
  FindingStatus,
  RiskConversationEntryKind,
  TicketStatus,
  TicketType,
} from "@/data/types";

export type Tone = "danger" | "success" | "warning" | "neutral" | "info";

export const toneClasses: Record<Tone, string> = {
  danger: "bg-danger/10 text-danger border-danger/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-primary/10 text-primary border-primary/20",
};

export const findingStatusConfig: Record<
  FindingStatus,
  { label: string; tone: Tone }
> = {
  at_risk: { label: "At Risk", tone: "danger" },
  reduced_risk: { label: "Reduced Risk", tone: "success" },
  inconclusive: { label: "Inconclusive", tone: "warning" },
};

export const severityConfig: Record<string, { label: string; tone: Tone }> = {
  critical: { label: "Critical", tone: "danger" },
  high: { label: "High", tone: "danger" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "info" },
  info: { label: "Info", tone: "neutral" },
};

export function severityToneOf(severity: string | null | undefined): Tone {
  if (!severity) return "neutral";
  return severityConfig[severity.toLowerCase()]?.tone ?? "neutral";
}

export function severityLabelOf(severity: string | null | undefined): string {
  if (!severity) return "Unrated";
  return (
    severityConfig[severity.toLowerCase()]?.label ??
    severity.charAt(0).toUpperCase() + severity.slice(1)
  );
}

export const platformConfig: Record<string, { label: string }> = {
  ios: { label: "iOS" },
  android: { label: "Android" },
};

export const testRunStatusConfig: Record<
  string,
  { label: string; tone: Tone }
> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export const ticketStatusConfig: Record<
  TicketStatus,
  { label: string; tone: Tone }
> = {
  open: { label: "Open", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "info" },
  fix_submitted: { label: "Fix Submitted", tone: "info" },
  retest_requested: { label: "Retest Requested", tone: "warning" },
  retest_in_progress: { label: "Retest In Progress", tone: "warning" },
  under_review: { label: "Under Review", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
};

export const ticketTypeConfig: Record<TicketType, { label: string }> = {
  remediation: { label: "Remediation" },
  risk_acceptance: { label: "Risk Acceptance" },
  retest_request: { label: "Retest Request" },
  app_provisioning: { label: "App Provisioning" },
};

export type ConversationEventKind = Exclude<RiskConversationEntryKind, "message">;

export const conversationEventConfig: Record<
  ConversationEventKind,
  { label: string; tone: Tone }
> = {
  classification_changed: { label: "Classification changed", tone: "info" },
  retest_requested: { label: "Reassessment requested", tone: "warning" },
  retest_started: { label: "Reassessment started", tone: "warning" },
  retest_completed: { label: "Reassessment completed", tone: "success" },
  retest_failed: { label: "Reassessment did not complete", tone: "danger" },
  remediation_started: { label: "Remediation started", tone: "info" },
  remediation_withdrawn: { label: "Remediation withdrawn", tone: "neutral" },
  fix_submitted: { label: "Fix submitted for review", tone: "info" },
};

/** Renders an event from its own recorded values, never by showing the stored metadata. */
export function conversationEventSummary(
  kind: ConversationEventKind,
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (kind !== "classification_changed") return conversationEventConfig[kind].label;
  const to = findingStatusLabelOf(metadata?.new_status);
  if (!to) return conversationEventConfig[kind].label;
  const from = findingStatusLabelOf(metadata?.previous_status);
  return from
    ? `Classification changed from ${from} to ${to}`
    : `Classification set to ${to}`;
}

function findingStatusLabelOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return findingStatusConfig[value as FindingStatus]?.label ?? null;
}

export const assessmentStatusConfig: Record<
  string,
  { label: string; tone: Tone }
> = {
  queued: { label: "Not Started", tone: "neutral" },
  waiting: { label: "Waiting to start", tone: "warning" },
  running: { label: "Assessing in progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

const BLOCKER_LABELS: Record<string, string> = {
  no_device: "Waiting for a compatible test device",
  device_unreachable: "Waiting for the test device to become reachable",
  app_build_missing: "Waiting for the app build",
  app_not_installed: "Waiting for the app to be installed on the test device",
  platform_busy: "Waiting for the test device to finish another run",
  automation_unavailable: "Waiting for the automation host",
  lease_expired: "Retry scheduled",
  configuration_incomplete: "Configuration needs attention",
  no_tests_enabled: "Configuration needs attention",
  retry_limit_reached: "Test execution could not start",
  assessment_missing: "Test execution could not start",
  invalid_run_request: "Test execution could not start",
};

/** Blockers no retry will clear on its own — mirrors the backend worker. */
const NON_RETRYABLE_BLOCKERS = new Set([
  "configuration_incomplete",
  "no_tests_enabled",
  "invalid_run_request",
  "retry_limit_reached",
  "assessment_missing",
]);

export interface AssessmentRunState {
  label: string;
  tone: Tone;
  detail: string | null;
  /** Whether the worker will try again on its own without anyone asking. */
  autoRetry: boolean;
  nextAttemptAt: string | null;
  canRetry: boolean;
  needsConfiguration: boolean;
}

/**
 * What to tell someone about an assessment that has not finished, combining the
 * assessment's own status with its durable execution request.
 */
export function assessmentRunState(
  assessment: Pick<Assessment, "status"> | null | undefined,
  request: AssessmentRunRequest | null | undefined,
): AssessmentRunState {
  const idle: AssessmentRunState = {
    label: "",
    tone: "neutral",
    detail: null,
    autoRetry: false,
    nextAttemptAt: null,
    canRetry: false,
    needsConfiguration: false,
  };
  if (!assessment) return idle;

  if (assessment.status === "completed") {
    return { ...idle, label: "Completed", tone: "success" };
  }

  const blocker = request?.blocker_code ?? null;
  const nonRetryable = !!blocker && NON_RETRYABLE_BLOCKERS.has(blocker);
  const detail = request?.last_error ?? null;
  const needsConfiguration =
    blocker === "configuration_incomplete" || blocker === "no_tests_enabled";

  if (assessment.status === "running" || request?.status === "running") {
    return { ...idle, label: "Automated tests are running", tone: "info" };
  }
  if (request?.status === "claimed") {
    return { ...idle, label: "Preparing the test environment", tone: "info" };
  }
  if (request?.status === "waiting") {
    return {
      ...idle,
      label: blocker ? (BLOCKER_LABELS[blocker] ?? "Waiting to start") : "Waiting to start",
      tone: "warning",
      detail,
      autoRetry: true,
      nextAttemptAt: request.next_attempt_at,
      canRetry: true,
      needsConfiguration,
    };
  }
  if (request?.status === "queued") {
    return { ...idle, label: "Queued for automated testing", tone: "neutral", canRetry: true };
  }
  if (request?.status === "failed" || assessment.status === "failed") {
    return {
      ...idle,
      label: blocker ? (BLOCKER_LABELS[blocker] ?? "Test execution could not start") : "Test execution could not start",
      tone: "danger",
      detail,
      canRetry: !nonRetryable,
      needsConfiguration,
    };
  }
  if (assessment.status === "waiting") {
    return { ...idle, label: "Waiting to start", tone: "warning", canRetry: true };
  }
  // Queued with no request yet: nothing has been asked of the worker.
  return { ...idle, label: "Queued for automated testing", tone: "neutral", canRetry: true };
}

/** Statuses a page should keep polling while it is open. */
export function isTransitionalRunState(
  assessment: Pick<Assessment, "status"> | null | undefined,
  request: AssessmentRunRequest | null | undefined,
): boolean {
  if (assessment && ["queued", "waiting", "running"].includes(assessment.status)) return true;
  return !!request && ["queued", "waiting", "claimed", "running"].includes(request.status);
}

/** A stage's own raw state, before it is placed in sequence. */
export type RawStageState = "done" | "in_progress" | "pending" | "failed" | "unknown";

export interface RawStageInput {
  id: string;
  label: string;
  description?: string;
  state: RawStageState;
  /** Text tone for this stage if it becomes the current one; icon never depends on it. */
  tone?: Tone;
}

export type AssessmentStageLifecycle =
  | "complete"
  | "current"
  | "future"
  | "failed"
  | "unknown"
  | "not_applicable";

export interface AssessmentStagePresentation {
  id: string;
  label: string;
  description?: string;
  lifecycle: AssessmentStageLifecycle;
  tone?: Tone;
}

/**
 * Places an ordered set of stages into a sequential stepper: every stage
 * before the first unresolved one is "complete", that one stage alone is
 * "current" (or "failed"/"unknown"), and everything after it is "future" —
 * regardless of what a later stage's own raw state happens to report. A
 * stepper never shows step 3 done while step 1 is still spinning.
 */
export function sequenceAssessmentStages(raw: RawStageInput[]): AssessmentStagePresentation[] {
  let resolved = true;
  return raw.map((stage): AssessmentStagePresentation => {
    const base = { id: stage.id, label: stage.label, description: stage.description };
    if (!resolved) return { ...base, lifecycle: "future" };

    switch (stage.state) {
      case "done":
        return { ...base, lifecycle: "complete" };
      case "failed":
        resolved = false;
        return { ...base, lifecycle: "failed" };
      case "unknown":
        resolved = false;
        return { ...base, lifecycle: "unknown" };
      case "in_progress":
      case "pending":
        resolved = false;
        return { ...base, lifecycle: "current", tone: stage.tone ?? "info" };
    }
  });
}

export interface AssessmentStageContext {
  /** Only consulted while live per-stage data has not arrived yet. */
  configurationReady: boolean;
  provisioningStages?: RawStageInput[];
  runState: AssessmentRunState;
  assessment: Pick<Assessment, "status" | "completed_tests" | "total_tests"> | null | undefined;
}

/**
 * The whole setup-and-run workflow as one sequence: three configuration
 * stages, automated testing, then analysis. Configuration and testing are
 * normalized from separate sources (provisioning readiness vs. the durable
 * run request) and only combined here, so a device or platform blocker on
 * testing can never make configuration look unfinished, or vice versa.
 */
export function normalizeAssessmentStages(ctx: AssessmentStageContext): AssessmentStagePresentation[] {
  const setup: RawStageInput[] = ctx.provisioningStages?.length
    ? ctx.provisioningStages
    : [
        {
          id: "app_registered",
          label: ctx.configurationReady
            ? "Server environment prepared"
            : "Server environment is being prepared",
          state: ctx.configurationReady ? "done" : "in_progress",
        },
        {
          id: "service_online",
          label: "Assessment service is running",
          state: ctx.configurationReady ? "done" : "pending",
        },
        {
          id: "configuration_applied",
          label: ctx.configurationReady ? "Configuration applied" : "Configuration is being applied",
          state: ctx.configurationReady ? "done" : "pending",
        },
      ];

  const completedTests = ctx.assessment?.completed_tests ?? 0;
  const totalTests = ctx.assessment?.total_tests ?? 0;
  const progress = totalTests > 0 ? `${completedTests} of ${totalTests} security tests run.` : undefined;
  const testingDone = ctx.assessment?.status === "completed";
  const nonRetryableFailure = ctx.runState.tone === "danger" && !ctx.runState.canRetry;

  const testing: RawStageInput = {
    id: "testing",
    label: testingDone ? "Automated testing complete" : ctx.runState.label || "Automated testing",
    description: testingDone
      ? progress
      : ctx.runState.tone === "info"
        ? progress
        : (ctx.runState.detail ?? undefined),
    state: testingDone ? "done" : nonRetryableFailure ? "failed" : "in_progress",
    tone: ctx.runState.tone,
  };

  const analysis: RawStageInput = {
    id: "analysis",
    label: "Analysis & reporting",
    state: testingDone ? "done" : "pending",
  };

  return sequenceAssessmentStages([...setup, testing, analysis]);
}
