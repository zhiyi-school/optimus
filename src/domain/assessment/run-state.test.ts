import { describe, expect, it } from "vitest";
import {
  assessmentRunState,
  isTransitionalRunState,
  normalizeAssessmentStages,
  sequenceAssessmentStages,
  type AssessmentRunState,
  type RawStageInput,
} from "@/domain/assessment/run-state";
import type { AssessmentRunRequest, AssessmentRunRequestStatus } from "@/database/types";

function request(
  status: AssessmentRunRequestStatus,
  overrides: Partial<AssessmentRunRequest> = {},
): AssessmentRunRequest {
  return {
    id: "request-1",
    assessment_id: "assessment-1",
    application_id: "application-1",
    platform: "ios",
    status,
    attempts: 1,
    next_attempt_at: "2026-01-01T00:05:00Z",
    claimed_at: null,
    lease_expires_at: null,
    worker_id: null,
    blocker_code: null,
    last_error: null,
    requested_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    started_at: null,
    completed_at: null,
    run_id: null,
    build_version: null,
    ...overrides,
  };
}

describe("what to tell someone about an assessment", () => {
  it("says it is queued when nothing has been claimed yet", () => {
    const state = assessmentRunState({ status: "queued" }, request("queued"));

    expect(state.label).toBe("Queued for automated testing");
    expect(state.canRetry).toBe(true);
    expect(state.autoRetry).toBe(false);
  });

  it("says a device is being waited for, and that it retries itself", () => {
    const state = assessmentRunState(
      { status: "waiting" },
      request("waiting", { blocker_code: "no_device", last_error: "No device is connected." }),
    );

    expect(state.label).toBe("Waiting for a compatible test device");
    expect(state.tone).toBe("warning");
    expect(state.autoRetry).toBe(true);
    expect(state.nextAttemptAt).toBe("2026-01-01T00:05:00Z");
    expect(state.canRetry).toBe(true);
  });

  it("names every temporary blocker in plain words", () => {
    for (const [blocker, label] of [
      ["device_unreachable", "Waiting for the test device to become reachable"],
      ["app_build_missing", "Waiting for the app build"],
      ["app_not_installed", "Waiting for the app to be installed on the test device"],
      ["platform_busy", "Waiting for the test device to finish another run"],
      ["automation_unavailable", "Waiting for the automation host"],
    ] as const) {
      const state = assessmentRunState({ status: "waiting" }, request("waiting", { blocker_code: blocker }));
      expect(state.label, blocker).toBe(label);
      expect(state.canRetry, blocker).toBe(true);
    }
  });

  it("says the environment is being prepared once a worker has it", () => {
    const state = assessmentRunState({ status: "queued" }, request("claimed"));

    expect(state.label).toBe("Preparing the test environment");
    expect(state.canRetry).toBe(false);
  });

  it("says tests are running, and offers no retry", () => {
    const state = assessmentRunState({ status: "running" }, request("running"));

    expect(state.label).toBe("Automated tests are running");
    expect(state.canRetry).toBe(false);
  });

  it("says tests are running once the request has started a run, never that it is queued", () => {
    for (const status of ["queued", "running"] as const) {
      const state = assessmentRunState({ status }, request("completed", { run_id: "example-run" }));

      expect(state.label, status).toBe("Automated tests are running");
      expect(state.tone, status).toBe("info");
      expect(state.canRetry, status).toBe(false);
      expect(state.testingFinished, status).toBe(false);
    }
  });

  it("follows the started run while it is still running", () => {
    const state = assessmentRunState(
      { status: "running" },
      request("completed", { run_id: "example-run" }),
      { run: "running" },
    );

    expect(state.label).toBe("Automated tests are running");
    expect(state.testingFinished).toBe(false);
  });

  it("moves on to analysis and reporting once the run has finished", () => {
    for (const sync of [undefined, null, "queued", "running", "completed"] as const) {
      const state = assessmentRunState(
        { status: "running" },
        request("completed", { run_id: "example-run" }),
        { run: "completed", sync },
      );

      expect(state.label, String(sync)).toBe("Analysis & reporting");
      expect(state.tone, String(sync)).toBe("info");
      expect(state.testingFinished, String(sync)).toBe(true);
      expect(state.detail, String(sync)).toContain("Testing finished");
    }
  });

  it("says the results could not be added when the dashboard sync failed", () => {
    const state = assessmentRunState(
      { status: "running" },
      request("completed", { run_id: "example-run" }),
      { run: "completed", sync: "failed" },
    );

    expect(state.label).toBe("Results could not be added to the dashboard");
    expect(state.tone).toBe("danger");
    expect(state.testingFinished).toBe(true);
    expect(state.canRetry).toBe(false);
  });

  it("offers a retry when the started run itself failed", () => {
    const state = assessmentRunState(
      { status: "running" },
      request("completed", { run_id: "example-run" }),
      { run: "failed" },
    );

    expect(state.label).toBe("Automated testing stopped with an error");
    expect(state.tone).toBe("danger");
    expect(state.canRetry).toBe(true);
    expect(state.testingFinished).toBe(false);
  });

  it("reports a failed assessment as failed even though its last request started a run", () => {
    const state = assessmentRunState({ status: "failed" }, request("completed", { run_id: "example-run" }));

    expect(state.label).toBe("Test execution could not start");
    expect(state.canRetry).toBe(true);
  });

  it("offers no retry once the assessment has completed", () => {
    const state = assessmentRunState({ status: "completed" }, request("completed"));

    expect(state.label).toBe("Completed");
    expect(state.canRetry).toBe(false);
  });

  it("offers a retry after a temporary failure", () => {
    const state = assessmentRunState(
      { status: "failed" },
      request("failed", { blocker_code: "no_device", last_error: "No device was available." }),
    );

    expect(state.tone).toBe("danger");
    expect(state.canRetry).toBe(true);
    expect(state.detail).toBe("No device was available.");
  });

  it("offers no retry for a failure retrying cannot fix", () => {
    for (const blocker of [
      "configuration_incomplete",
      "no_tests_enabled",
      "invalid_run_request",
      "retry_limit_reached",
    ]) {
      const state = assessmentRunState({ status: "failed" }, request("failed", { blocker_code: blocker }));
      expect(state.canRetry, blocker).toBe(false);
    }
  });

  it("points at the configuration when that is what needs attention", () => {
    const state = assessmentRunState(
      { status: "failed" },
      request("failed", { blocker_code: "configuration_incomplete" }),
    );

    expect(state.label).toBe("Configuration needs attention");
    expect(state.needsConfiguration).toBe(true);
  });

  it("never shows a raw error as the headline", () => {
    const state = assessmentRunState(
      { status: "failed" },
      request("failed", {
        blocker_code: "no_device",
        last_error: "Traceback (most recent call last): RuntimeError: device.udid missing",
      }),
    );

    expect(state.label).not.toContain("Traceback");
    expect(state.label).toBe("Waiting for a compatible test device");
  });

  it("still says something useful before any request exists", () => {
    const state = assessmentRunState({ status: "queued" }, null);

    expect(state.label).toBe("Queued for automated testing");
    expect(state.canRetry).toBe(true);
  });

  it("copes with an unknown blocker rather than showing its code", () => {
    const state = assessmentRunState(
      { status: "waiting" },
      request("waiting", { blocker_code: "something_new" }),
    );

    expect(state.label).toBe("Waiting to start");
    expect(state.canRetry).toBe(true);
  });

  it("says nothing at all when there is no assessment", () => {
    expect(assessmentRunState(null, null).label).toBe("");
  });
});

describe("when to keep polling", () => {
  it("keeps polling while the assessment has not settled", () => {
    for (const status of ["queued", "waiting", "running"] as const) {
      expect(isTransitionalRunState({ status }, null), status).toBe(true);
    }
  });

  it("keeps polling while a request is still in flight", () => {
    for (const status of ["queued", "waiting", "claimed", "running"] as const) {
      expect(isTransitionalRunState({ status: "failed" }, request(status)), status).toBe(true);
    }
  });

  it("stops for a settled assessment with no request in flight", () => {
    expect(isTransitionalRunState({ status: "completed" }, request("completed"))).toBe(false);
    expect(isTransitionalRunState({ status: "failed" }, request("failed"))).toBe(false);
  });
});

function countCurrent(stages: ReturnType<typeof sequenceAssessmentStages>) {
  return stages.filter((s) => s.lifecycle === "current").length;
}

function runState(overrides: Partial<AssessmentRunState> & { label: string; tone: AssessmentRunState["tone"] }): AssessmentRunState {
  return {
    detail: null,
    autoRetry: false,
    nextAttemptAt: null,
    canRetry: false,
    needsConfiguration: false,
    testingFinished: false,
    ...overrides,
  };
}

describe("sequencing a set of stages into one stepper", () => {
  const done = (id: string): RawStageInput => ({ id, label: id, state: "done" });

  it("marks nothing current once every stage is done", () => {
    const stages = sequenceAssessmentStages([done("a"), done("b"), done("c")]);
    expect(countCurrent(stages)).toBe(0);
    expect(stages.map((s) => s.lifecycle)).toEqual(["complete", "complete", "complete"]);
  });

  it("marks exactly the first unresolved stage current, never a later one", () => {
    const stages = sequenceAssessmentStages([
      done("a"),
      { id: "b", label: "b", state: "in_progress" },
      { id: "c", label: "c", state: "in_progress" },
    ]);
    expect(countCurrent(stages)).toBe(1);
    expect(stages.map((s) => s.lifecycle)).toEqual(["complete", "current", "future"]);
  });

  it("forces a later stage to future even if it independently reports done", () => {
    const stages = sequenceAssessmentStages([
      { id: "a", label: "a", state: "in_progress" },
      done("b"),
      { id: "c", label: "c", state: "pending" },
    ]);
    expect(countCurrent(stages)).toBe(1);
    expect(stages.map((s) => s.lifecycle)).toEqual(["current", "future", "future"]);
  });

  it("marks a failed unresolved stage failed, not current, and stops the sequence there", () => {
    const stages = sequenceAssessmentStages([
      done("a"),
      { id: "b", label: "b", state: "failed" },
      { id: "c", label: "c", state: "pending" },
    ]);
    expect(countCurrent(stages)).toBe(0);
    expect(stages.map((s) => s.lifecycle)).toEqual(["complete", "failed", "future"]);
  });

  it("marks an unknown unresolved stage unknown, not current", () => {
    const stages = sequenceAssessmentStages([
      done("a"),
      { id: "b", label: "b", state: "unknown" },
      { id: "c", label: "c", state: "pending" },
    ]);
    expect(countCurrent(stages)).toBe(0);
    expect(stages.map((s) => s.lifecycle)).toEqual(["complete", "unknown", "future"]);
  });

  it("never produces more than one current stage, across every state combination", () => {
    const states = ["done", "in_progress", "pending", "failed", "unknown"] as const;
    for (const a of states) {
      for (const b of states) {
        for (const c of states) {
          const stages = sequenceAssessmentStages([
            { id: "a", label: "a", state: a },
            { id: "b", label: "b", state: b },
            { id: "c", label: "c", state: c },
          ]);
          expect(countCurrent(stages), `${a},${b},${c}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("normalizing the full assessment workflow", () => {
  const idle = { status: "queued" as const, completed_tests: 0, total_tests: 4 };

  it("spins environment preparation alone when nothing is registered", () => {
    const stages = normalizeAssessmentStages({
      configurationReady: false,
      runState: runState({ label: "Queued for automated testing", tone: "neutral" }),
      assessment: idle,
    });
    expect(countCurrent(stages)).toBe(1);
    expect(stages[0].lifecycle).toBe("current");
    expect(stages.slice(1).every((s) => s.lifecycle === "future")).toBe(true);
  });

  it("spins automated testing once configuration is ready, independent of device state", () => {
    const stages = normalizeAssessmentStages({
      configurationReady: true,
      runState: runState({ label: "Waiting for a compatible test device", tone: "warning", canRetry: true }),
      assessment: idle,
    });
    expect(countCurrent(stages)).toBe(1);
    expect(stages.map((s) => s.lifecycle)).toEqual(["complete", "complete", "complete", "current", "future"]);
  });

  it("keeps a retryable testing failure current rather than failed", () => {
    const stages = normalizeAssessmentStages({
      configurationReady: true,
      runState: runState({ label: "Test execution could not start", tone: "danger", canRetry: true }),
      assessment: idle,
    });
    const testing = stages.find((s) => s.id === "testing")!;
    expect(testing.lifecycle).toBe("current");
  });

  it("fails testing, not current, for a non-retryable blocker", () => {
    const stages = normalizeAssessmentStages({
      configurationReady: true,
      runState: runState({ label: "Configuration needs attention", tone: "danger", canRetry: false }),
      assessment: idle,
    });
    const testing = stages.find((s) => s.id === "testing")!;
    expect(testing.lifecycle).toBe("failed");
    expect(stages.find((s) => s.id === "analysis")!.lifecycle).toBe("future");
  });

  it("completes testing and makes analysis current once the run has finished", () => {
    const stages = normalizeAssessmentStages({
      configurationReady: true,
      runState: runState({
        label: "Analysis & reporting",
        tone: "info",
        detail: "Testing finished. The results are being analyzed and added to the dashboard.",
        testingFinished: true,
      }),
      assessment: { status: "running", completed_tests: 0, total_tests: 4 },
    });
    const analysis = stages.find((s) => s.id === "analysis")!;
    expect(stages.find((s) => s.id === "testing")!.lifecycle).toBe("complete");
    expect(analysis.lifecycle).toBe("current");
    expect(analysis.description).toContain("Testing finished");
    expect(countCurrent(stages)).toBe(1);
  });

  it("fails analysis, not testing, when the dashboard sync failed", () => {
    const stages = normalizeAssessmentStages({
      configurationReady: true,
      runState: runState({
        label: "Results could not be added to the dashboard",
        tone: "danger",
        testingFinished: true,
      }),
      assessment: { status: "running", completed_tests: 0, total_tests: 4 },
    });
    expect(stages.find((s) => s.id === "testing")!.lifecycle).toBe("complete");
    expect(stages.find((s) => s.id === "analysis")!.lifecycle).toBe("failed");
  });

  it("shows the live count of finished tests while the run is testing", () => {
    const stages = normalizeAssessmentStages({
      configurationReady: true,
      runState: runState({ label: "Automated tests are running", tone: "info" }),
      assessment: { status: "running", completed_tests: 0, total_tests: 4 },
      liveCompletedTests: 2,
    });
    expect(stages.find((s) => s.id === "testing")!.description).toBe("2 of 4 security tests run.");
  });

  it("falls back to the stored count when there is no live count", () => {
    const stages = normalizeAssessmentStages({
      configurationReady: true,
      runState: runState({ label: "Automated tests are running", tone: "info" }),
      assessment: { status: "running", completed_tests: 1, total_tests: 4 },
    });
    expect(stages.find((s) => s.id === "testing")!.description).toBe("1 of 4 security tests run.");
  });

  it("uses the stored count once the assessment has completed", () => {
    const stages = normalizeAssessmentStages({
      configurationReady: true,
      runState: runState({ label: "Completed", tone: "success" }),
      assessment: { status: "completed", completed_tests: 4, total_tests: 4 },
      liveCompletedTests: 3,
    });
    expect(stages.find((s) => s.id === "testing")!.description).toBe("4 of 4 security tests run.");
  });

  it("completes both testing and analysis, with no current stage, once the assessment is done", () => {
    const stages = normalizeAssessmentStages({
      configurationReady: true,
      runState: runState({ label: "Completed", tone: "success" }),
      assessment: { status: "completed", completed_tests: 4, total_tests: 4 },
    });
    expect(countCurrent(stages)).toBe(0);
    expect(stages.find((s) => s.id === "testing")!.lifecycle).toBe("complete");
    expect(stages.find((s) => s.id === "analysis")!.lifecycle).toBe("complete");
  });
});
