import { describe, expect, it } from "vitest";
import { countCompletedTests } from "@/domain/run/run-progress";
import type { RunProgressEvent } from "@/automation-api/types";

const completed = (risk_id: string, app_id = "example_app"): RunProgressEvent => ({
  type: "risk_completed",
  app_id,
  risk_id,
});

describe("counting the tests a run has finished", () => {
  it("counts each finished test once", () => {
    const events = [completed("risk-a"), completed("risk-b"), completed("risk-a")];

    expect(countCompletedTests(events, "example_app")).toBe(2);
  });

  it("ignores tests that have only started and other kinds of event", () => {
    const events: RunProgressEvent[] = [
      { type: "risk_started", app_id: "example_app", risk_id: "risk-a" },
      { type: "permission_prompts_answered", risk_id: "risk-a" },
      { type: "done", status: "running" },
      completed("risk-b"),
    ];

    expect(countCompletedTests(events, "example_app")).toBe(1);
  });

  it("counts only this app's tests", () => {
    const events = [completed("risk-a"), completed("risk-b", "other_app")];

    expect(countCompletedTests(events, "example_app")).toBe(1);
  });

  it("is zero before anything has finished", () => {
    expect(countCompletedTests([], "example_app")).toBe(0);
  });
});
