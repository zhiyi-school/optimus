// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleCan, type Capability } from "@/auth/permissions";
import type { AssessmentRunRequest, AssessmentStatus, UserRole } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASSESSMENT = "example-assessment-id";
const APPLICATION = "example-app-id";

let roles: UserRole[] = ["security"];
let assessmentStatus: AssessmentStatus = "queued";
let runRequest: AssessmentRunRequest | null = null;
let requestCalls: number;
let requestPending: boolean;
let requestError: unknown;
let pollArgs: { status: AssessmentStatus | undefined } | null = null;

function request(overrides: Partial<AssessmentRunRequest> = {}): AssessmentRunRequest {
  return {
    id: "request-1",
    assessment_id: ASSESSMENT,
    application_id: APPLICATION,
    platform: "ios",
    status: "queued",
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

const application = {
  id: APPLICATION,
  external_id: "example_app",
  name: "Example Application",
  platform: "ios",
  provisioning_status: "ready",
  provisioning_error: null,
};

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "user-1", display_name: "Example Person", roles },
    can: (capability: Capability) => roleCan(roles, capability),
  }),
}));

vi.mock("@/hooks/queries", () => {
  const idle = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  return {
    useAssessment: () => ({
      ...idle,
      data: {
        id: ASSESSMENT,
        external_id: "manual::example",
        application_id: APPLICATION,
        application,
        status: assessmentStatus,
        total_tests: 3,
        completed_tests: 0,
      },
    }),
    useAssessmentRunRequest: (
      _id: string | undefined,
      assessment: { status: AssessmentStatus } | undefined,
    ) => {
      pollArgs = { status: assessment?.status };
      return { ...idle, data: runRequest };
    },
    useRequestAssessmentRun: () => ({
      mutate: () => {
        requestCalls += 1;
      },
      mutateAsync: () => {
        requestCalls += 1;
        return Promise.resolve();
      },
      isPending: requestPending,
      isError: !!requestError,
      error: requestError,
    }),
    useRiskCatalogue: () => ({ ...idle, data: [] }),
    useFindings: () => ({ ...idle, data: [] }),
    useTickets: () => ({ ...idle, data: [] }),
    useAppProvisioning: () => ({ ...idle, data: undefined }),
    useUpdateApplication: () => ({ mutate: () => {}, isPending: false }),
  };
});

const AssessmentDetail = (await import("@/pages/AssessmentDetail")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  roles = ["security"];
  assessmentStatus = "queued";
  runRequest = null;
  requestCalls = 0;
  requestPending = false;
  requestError = undefined;
  pollArgs = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[`/assessments/${ASSESSMENT}`]}>
        <Routes>
          <Route path="/assessments/:assessmentId" element={<AssessmentDetail />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

function retryButton() {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("Retry"),
  );
}

describe("what the page says an assessment is doing", () => {
  it("says a queued assessment is queued", () => {
    runRequest = request({ status: "queued" });
    render();

    expect(text()).toContain("Queued for automated testing");
  });

  it("says why an assessment is waiting, and that it retries itself", () => {
    assessmentStatus = "waiting";
    runRequest = request({
      status: "waiting",
      blocker_code: "no_device",
      last_error: "No compatible test device is connected.",
    });
    render();

    expect(text()).toContain("Waiting for a compatible test device");
    expect(text()).toContain("No compatible test device is connected.");
    expect(text()).toContain("This retries automatically");
  });

  it("says tests are running", () => {
    assessmentStatus = "running";
    runRequest = request({ status: "running" });
    render();

    expect(text()).toContain("Automated tests are running");
  });

  it("shows nothing to chase once the assessment has completed", () => {
    assessmentStatus = "completed";
    runRequest = request({ status: "completed" });
    render();

    expect(retryButton()).toBeUndefined();
    expect(text()).not.toContain("Queued for automated testing");
  });

  it("never puts a raw error in the heading", () => {
    assessmentStatus = "failed";
    runRequest = request({
      status: "failed",
      blocker_code: "no_device",
      last_error: "RuntimeError: device.udid '00008030' is not connected",
    });
    render();

    const headings = [...container.querySelectorAll("h2")].map((h) => h.textContent);
    expect(headings).toContain("Waiting for a compatible test device");
    expect(headings.join(" ")).not.toContain("RuntimeError");
  });
});

describe("retrying", () => {
  it("offers a retry while an assessment waits for a device", () => {
    assessmentStatus = "waiting";
    runRequest = request({ status: "waiting", blocker_code: "no_device" });
    render();

    expect(retryButton()).toBeDefined();
  });

  it("offers a retry after a temporary failure", () => {
    assessmentStatus = "failed";
    runRequest = request({ status: "failed", blocker_code: "platform_busy" });
    render();

    expect(retryButton()).toBeDefined();
  });

  it("sends one request per click", () => {
    assessmentStatus = "waiting";
    runRequest = request({ status: "waiting", blocker_code: "no_device" });
    render();

    const button = retryButton()!;
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(requestCalls).toBe(1);
  });

  it("cannot be clicked twice while it is in flight", () => {
    assessmentStatus = "waiting";
    runRequest = request({ status: "waiting", blocker_code: "no_device" });
    requestPending = true;
    render();

    const button = retryButton()!;
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toContain("Retrying…");
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(requestCalls).toBe(0);
  });

  it("is not offered while the tests are running", () => {
    assessmentStatus = "running";
    runRequest = request({ status: "running" });
    render();

    expect(retryButton()).toBeUndefined();
  });

  it("is not offered while a worker is preparing the environment", () => {
    runRequest = request({ status: "claimed" });
    render();

    expect(retryButton()).toBeUndefined();
  });

  it("is not offered for a failure retrying cannot fix", () => {
    assessmentStatus = "failed";
    runRequest = request({ status: "failed", blocker_code: "configuration_incomplete" });
    render();

    expect(retryButton()).toBeUndefined();
    expect(text()).toContain("Review the app configuration");
  });

  it("is not offered to someone who cannot run tests", () => {
    roles = ["developer"];
    assessmentStatus = "waiting";
    runRequest = request({ status: "waiting", blocker_code: "no_device" });
    render();

    expect(retryButton()).toBeUndefined();
  });

  it("says so when the retry itself fails", () => {
    assessmentStatus = "waiting";
    runRequest = request({ status: "waiting", blocker_code: "no_device" });
    requestError = { userFacing: true, message: "This assessment is outside your access." };
    render();

    expect(text()).toContain("This assessment is outside your access.");
  });
});

describe("keeping the page current", () => {
  it("tells the poller what the assessment is doing, so it can keep looking", () => {
    assessmentStatus = "waiting";
    runRequest = request({ status: "waiting", blocker_code: "no_device" });
    render();

    expect(pollArgs).toEqual({ status: "waiting" });
  });

  it("does not start a run merely because the page was opened", async () => {
    const runs = await import("@/data/sync");
    expect("runAllTests" in runs.syncService).toBe(false);
    expect(Object.keys(runs.syncService)).not.toContain("runAllTests");
  });
});
