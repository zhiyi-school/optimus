/**
 * Run state and stage sequencing for an assessment's execution request and provisioning workflow.
 */

import type { DashboardSyncStatus, RunStatus } from "@/automation-api/types";
import type { Assessment, AssessmentRunRequest } from "@/database/types";
import { createDebug } from "@/lib/debug";
import type { Tone } from "@/domain/status-labels";

const debug = createDebug("domain:assessment:run-state");

const BLOCKER_LABELS: Record<string, string> = {
  no_device: "Waiting for a compatible test device",
  device_unreachable: "Waiting for the test device to become reachable",
  app_build_missing: "Waiting for the app build",
  app_not_installed: "Waiting for the app to be installed on the test device",
  app_install_timeout: "Waiting to retry installing the app",
  app_install_failed: "Waiting to retry installing the app",
  app_paid: "Paid app must be installed by a person",
  app_unavailable: "App is not available from the Play Store",
  store_account_action_required: "Play Store account needs attention",
  store_screen_unrecognised: "Play Store screen was not recognised",
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
  /** The run finished, so what remains is analysis and reporting. */
  testingFinished: boolean;
}

/** What the automation host reports about the run a completed request started. */
export interface StartedRunProgress {
  run?: RunStatus | null;
  sync?: DashboardSyncStatus | null;
}

/** Describes an unfinished assessment's run state from its status, its execution request and the run it started. */
export function assessmentRunState(
  assessment: Pick<Assessment, "status"> | null | undefined,
  request: AssessmentRunRequest | null | undefined,
  started: StartedRunProgress = {},
): AssessmentRunState {
  const idle: AssessmentRunState = {
    label: "",
    tone: "neutral",
    detail: null,
    autoRetry: false,
    nextAttemptAt: null,
    canRetry: false,
    needsConfiguration: false,
    testingFinished: false,
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
  debug("maps run state", {
    assessmentStatus: assessment.status,
    requestStatus: request?.status ?? null,
    blocker,
    nonRetryable,
    needsConfiguration,
    run: started.run ?? null,
    sync: started.sync ?? null,
  });

  // A request completes when its run is accepted, so the run itself says how far testing has got.
  if (request?.status === "completed" && assessment.status !== "failed") {
    return startedRunState(idle, started);
  }
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
  return { ...idle, label: "Queued for automated testing", tone: "neutral", canRetry: true };
}

/** Run state once a request has started a run: testing until the run ends, then analysis and reporting. */
function startedRunState(idle: AssessmentRunState, started: StartedRunProgress): AssessmentRunState {
  if (started.run === "failed") {
    return { ...idle, label: "Automated testing stopped with an error", tone: "danger", canRetry: true };
  }
  if (started.run !== "completed") {
    return { ...idle, label: "Automated tests are running", tone: "info" };
  }
  if (started.sync === "failed") {
    return {
      ...idle,
      label: "Results could not be added to the dashboard",
      tone: "danger",
      detail: "Testing finished, but writing its results to the dashboard failed. Resync the run from its run page.",
      testingFinished: true,
    };
  }
  return {
    ...idle,
    label: "Analysis & reporting",
    tone: "info",
    detail: "Testing finished. The results are being analyzed and added to the dashboard.",
    testingFinished: true,
  };
}

/** True while the assessment or its run request is in a state a page should keep polling. */
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

/** Sequences stages: done ones before the first unresolved stage, that stage current, every later one future. */
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

/** Builds the setup, testing and analysis stepper, keeping configuration and testing sources independent. */
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

  const assessmentDone = ctx.assessment?.status === "completed";
  const testingDone = assessmentDone || ctx.runState.testingFinished;
  const nonRetryableFailure = ctx.runState.tone === "danger" && !ctx.runState.canRetry;

  const testing: RawStageInput = {
    id: "testing",
    label: testingDone ? "Automated testing complete" : ctx.runState.label || "Automated testing",
    description: testingDone || ctx.runState.tone === "info" ? undefined : (ctx.runState.detail ?? undefined),
    state: testingDone ? "done" : nonRetryableFailure ? "failed" : "in_progress",
    tone: ctx.runState.tone,
  };

  const analysis: RawStageInput = {
    id: "analysis",
    label: "Analysis & reporting",
    description: !assessmentDone && testingDone ? (ctx.runState.detail ?? undefined) : undefined,
    state: assessmentDone
      ? "done"
      : testingDone
        ? ctx.runState.tone === "danger"
          ? "failed"
          : "in_progress"
        : "pending",
    tone: ctx.runState.tone,
  };

  return sequenceAssessmentStages([...setup, testing, analysis]);
}
