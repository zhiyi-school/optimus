// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvironmentSetupStages } from "@/components/assessment-progress";
import type { ProvisioningStage } from "@/api/automation-types";
import type { AssessmentRunState, Tone } from "@/lib/status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Parameters<typeof EnvironmentSetupStages>[0]) {
  act(() => root.render(<EnvironmentSetupStages {...props} />));
}

function labels() {
  return [...container.querySelectorAll("li p.text-sm.font-semibold")].map((p) => p.textContent);
}

function spinners() {
  return container.querySelectorAll("svg.animate-spin");
}

function stepMarkers() {
  return container.querySelectorAll('[aria-current="step"]');
}

const stage = (overrides: Partial<ProvisioningStage>): ProvisioningStage => ({
  id: "configuration_applied",
  label: "Configuration applied",
  state: "done",
  ...overrides,
});

function runState(overrides: Partial<AssessmentRunState> & { label: string; tone: Tone }): AssessmentRunState {
  return {
    detail: null,
    autoRetry: false,
    nextAttemptAt: null,
    canRetry: false,
    needsConfiguration: false,
    ...overrides,
  };
}

const idleAssessment = { status: "queued", completed_tests: 0, total_tests: 4 } as const;

describe("exactly one current stage", () => {
  it("spins only environment preparation while nothing is registered yet", () => {
    render({
      configurationReady: false,
      assessment: idleAssessment,
      runState: runState({ label: "Queued for automated testing", tone: "neutral" }),
    });

    expect(spinners()).toHaveLength(1);
    expect(labels()).toEqual([
      "Server environment is being prepared",
      "Assessment service is running",
      "Configuration is being applied",
      "Queued for automated testing",
      "Analysis & reporting",
    ]);
    expect(stepMarkers()).toHaveLength(1);
    expect(stepMarkers()[0].textContent).toContain("Server environment is being prepared");
  });

  it("does not check a later stage merely because the backend reports it independently done", () => {
    // The real backend always marks "service online" done, even before the
    // app itself is registered — the stepper must not show that as a check
    // while environment preparation is still the current stage.
    render({
      stages: [
        stage({ id: "app_registered", label: "Server environment is being prepared", state: "in_progress" }),
        stage({ id: "service_online", label: "Assessment service is running", state: "done" }),
        stage({ id: "configuration_applied", label: "Configuration is being applied", state: "pending" }),
      ],
      assessment: idleAssessment,
      runState: runState({ label: "Queued for automated testing", tone: "neutral" }),
    });

    expect(spinners()).toHaveLength(1);
    const list = [...container.querySelectorAll("ol > li")];
    expect(list[0].textContent).toContain("Server environment is being prepared");
    expect(list[1].querySelector("svg")).toBeNull(); // future: empty circle, no icon at all
    expect(list[1].querySelector(".border-2")).not.toBeNull();
  });

  it("spins configuration once the earlier stages are done", () => {
    render({
      stages: [
        stage({ id: "app_registered", label: "Server environment prepared", state: "done" }),
        stage({ id: "service_online", label: "Assessment service is running", state: "done" }),
        stage({ id: "configuration_applied", label: "Configuration is being applied", state: "in_progress" }),
      ],
      assessment: idleAssessment,
      runState: runState({ label: "Queued for automated testing", tone: "neutral" }),
    });

    expect(spinners()).toHaveLength(1);
    expect(labels().slice(0, 3)).toEqual([
      "Server environment prepared",
      "Assessment service is running",
      "Configuration is being applied",
    ]);
    // Testing and analysis are forced future even though their own state would spin.
    expect(labels().slice(3)).toEqual(["Queued for automated testing", "Analysis & reporting"]);
  });

  it("spins automated testing once configuration is complete, even with no device", () => {
    render({
      configurationReady: true,
      stages: [
        stage({ id: "app_registered", state: "done" }),
        stage({ id: "service_online", state: "done" }),
        stage({ id: "configuration_applied", label: "Configuration applied", state: "done" }),
      ],
      assessment: idleAssessment,
      runState: runState({
        label: "Waiting for a compatible test device",
        tone: "warning",
        detail: "No compatible test device is connected.",
        autoRetry: true,
        canRetry: true,
      }),
    });

    expect(spinners()).toHaveLength(1);
    expect(container.textContent).toContain("Configuration applied");
    expect(container.textContent).toContain("Waiting for a compatible test device");
    expect(container.textContent).toContain("No compatible test device is connected.");
    expect(container.textContent).toContain("Analysis & reporting");
    expect(spinners()).toHaveLength(1);
  });

  it("has no current stage, and no spinner, once the assessment is completed", () => {
    render({
      configurationReady: true,
      assessment: { status: "completed", completed_tests: 4, total_tests: 4 },
      runState: runState({ label: "Completed", tone: "success" }),
    });

    expect(spinners()).toHaveLength(0);
    expect(stepMarkers()).toHaveLength(0);
    expect(container.textContent).toContain("Automated testing complete");
    expect(container.textContent).toContain("4 of 4 security tests run.");
  });

  it("marks an unresolved backend-unknown stage as unknown, not spinning", () => {
    render({
      stages: [
        stage({ id: "app_registered", state: "done" }),
        stage({ id: "service_online", state: "done" }),
        stage({
          id: "configuration_applied",
          label: "Configuration applied",
          state: "unknown",
          detail: "The test device could not be reached.",
        }),
      ],
      assessment: idleAssessment,
      runState: runState({ label: "Queued for automated testing", tone: "neutral" }),
    });

    expect(spinners()).toHaveLength(0);
    expect(container.querySelector("svg.lucide-circle-help")).not.toBeNull();
    expect(container.textContent).toContain("The test device could not be reached.");
  });

  it("marks a failed current stage with a failure icon and stops the sequence there", () => {
    render({
      stages: [
        stage({ id: "app_registered", state: "done" }),
        stage({ id: "service_online", state: "done" }),
        stage({
          id: "configuration_applied",
          label: "Configuration could not be applied",
          state: "failed",
          detail: "This app's test configuration needs attention.",
        }),
      ],
      assessment: idleAssessment,
      runState: runState({ label: "Configuration needs attention", tone: "danger" }),
    });

    expect(spinners()).toHaveLength(0);
    const list = [...container.querySelectorAll("ol > li")];
    expect(list[2].textContent).toContain("Configuration could not be applied");
    expect(list[2].querySelector("svg.lucide-x")).not.toBeNull();
    // Later stages remain future — empty, not failed.
    expect(list[3].querySelector("svg.lucide-x")).toBeNull();
    expect(list[4].querySelector("svg.lucide-x")).toBeNull();
  });

  it("keeps automated testing current, still spinning, for a retryable failure", () => {
    render({
      configurationReady: true,
      assessment: idleAssessment,
      runState: runState({
        label: "Test execution could not start",
        tone: "danger",
        detail: "Another run is already using the test device.",
        canRetry: true,
      }),
    });

    expect(spinners()).toHaveLength(1);
    expect(container.textContent).toContain("Test execution could not start");
  });

  it("shows a failure icon, not a spinner, for a non-retryable failure", () => {
    render({
      configurationReady: true,
      assessment: idleAssessment,
      runState: runState({ label: "Configuration needs attention", tone: "danger", canRetry: false }),
    });

    expect(spinners()).toHaveLength(0);
    expect(container.querySelector("svg.lucide-x")).not.toBeNull();
  });
});

describe("run-request lifecycle scenarios", () => {
  const setupDone: ProvisioningStage[] = [
    stage({ id: "app_registered", state: "done" }),
    stage({ id: "service_online", state: "done" }),
    stage({ id: "configuration_applied", label: "Configuration applied", state: "done" }),
  ];

  it("queued", () => {
    render({
      configurationReady: true,
      stages: setupDone,
      assessment: idleAssessment,
      runState: runState({ label: "Queued for automated testing", tone: "neutral", canRetry: true }),
    });
    expect(spinners()).toHaveLength(1);
    expect(container.textContent).toContain("Queued for automated testing");
  });

  it("claimed — preparing the environment", () => {
    render({
      configurationReady: true,
      stages: setupDone,
      assessment: idleAssessment,
      runState: runState({ label: "Preparing the test environment", tone: "info" }),
    });
    expect(spinners()).toHaveLength(1);
    expect(container.textContent).toContain("Preparing the test environment");
  });

  it("running, with progress", () => {
    render({
      configurationReady: true,
      stages: setupDone,
      assessment: { status: "running", completed_tests: 2, total_tests: 4 },
      runState: runState({ label: "Automated tests are running", tone: "info" }),
    });
    expect(spinners()).toHaveLength(1);
    expect(container.textContent).toContain("Automated tests are running");
    expect(container.textContent).toContain("2 of 4 security tests run.");
  });

  it("waiting, with the next retry time", () => {
    render({
      configurationReady: true,
      stages: setupDone,
      assessment: idleAssessment,
      runState: runState({
        label: "Waiting for the test device to finish another run",
        tone: "warning",
        autoRetry: true,
        nextAttemptAt: "2026-01-01T00:05:00Z",
        canRetry: true,
      }),
    });
    expect(spinners()).toHaveLength(1);
    expect(container.textContent).toContain("Waiting for the test device to finish another run");
  });

  it("completed — testing and analysis both check, no spinner", () => {
    render({
      configurationReady: true,
      stages: setupDone,
      assessment: { status: "completed", completed_tests: 4, total_tests: 4 },
      runState: runState({ label: "Completed", tone: "success" }),
    });
    expect(spinners()).toHaveLength(0);
    const list = [...container.querySelectorAll("ol > li")];
    for (const item of list) {
      expect(item.querySelector("svg.lucide-x")).toBeNull();
    }
  });
});

describe("accessibility and reduced motion", () => {
  it("marks the current stage for assistive technology", () => {
    render({
      configurationReady: true,
      assessment: idleAssessment,
      runState: runState({ label: "Automated tests are running", tone: "info" }),
    });
    expect(stepMarkers()).toHaveLength(1);
    expect(stepMarkers()[0].textContent).toContain("Automated tests are running");
  });

  it("does not rely on color alone: current, failed and future render distinct icon markup", () => {
    render({
      configurationReady: true,
      assessment: idleAssessment,
      runState: runState({ label: "Waiting for a compatible test device", tone: "warning" }),
    });
    const waitingIcon = container.querySelector("ol > li:nth-child(4) svg, ol > li:nth-child(4) div")?.outerHTML;

    act(() => root.unmount());
    root = createRoot(container);
    render({
      configurationReady: true,
      assessment: idleAssessment,
      runState: runState({ label: "Configuration needs attention", tone: "danger", canRetry: false }),
    });
    const failedIcon = container.querySelector("ol > li:nth-child(4) svg, ol > li:nth-child(4) div")?.outerHTML;

    expect(waitingIcon).not.toBe(failedIcon);
  });

  it("keeps the reduced-motion escape hatch on the current-stage spinner", () => {
    render({
      configurationReady: true,
      assessment: idleAssessment,
      runState: runState({ label: "Automated tests are running", tone: "info" }),
    });
    expect(container.querySelector("svg.animate-spin")?.getAttribute("class")).toContain(
      "motion-reduce:animate-none",
    );
  });
});
