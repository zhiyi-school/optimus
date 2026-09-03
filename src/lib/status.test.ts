import { describe, expect, it } from "vitest";
import { assessmentRunState, isTransitionalRunState } from "@/lib/status";
import type { AssessmentRunRequest, AssessmentRunRequestStatus } from "@/data/types";

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
