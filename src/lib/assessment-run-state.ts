/**
 * Run state and stage sequencing for an assessment's execution request and provisioning workflow.
 */

import type { Assessment, AssessmentRunRequest } from "@/data/types";
import { createDebug } from "@/lib/debug";
import type { Tone } from "@/lib/status";

const debug = createDebug("lib:assessment-run-state");

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

/** Describes an unfinished assessment's run state from its status and its durable execution request. */
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
  debug("maps run state", {
    assessmentStatus: assessment.status,
    requestStatus: request?.status ?? null,
    blocker,
    nonRetryable,
    needsConfiguration,
  });

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
