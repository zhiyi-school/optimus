import { describe, expect, it } from "vitest";
import type { ControlDetail } from "@/automation-api/playbook-types";
import {
  changedSinceCompleted,
  contentHashes,
  controlSummary,
  introRepeatsSummary,
} from "./control-content";
import { liveControls } from "./resolve";
import { REVOKE, ROTATE, control, definition, step } from "@/test-support/resolve-fixtures";

describe("changedSinceCompleted", () => {
  const live = () =>
    liveControls([definition()], [control()], [
      step("tc-1", ROTATE, "completed"),
      step("tc-1", REVOKE),
    ])[0].steps;

  it("flags a completed step whose content changed during the session", () => {
    const atLoad = new Map([[ROTATE, "sha256:before"]]);
    expect([...changedSinceCompleted(live(), atLoad)]).toEqual([ROTATE]);
  });

  it("says nothing when the content is unchanged", () => {
    expect([...changedSinceCompleted(live(), contentHashes(definition().steps))]).toEqual([]);
  });

  it("does not flag a step the developer has not completed", () => {
    const atLoad = new Map([[REVOKE, "sha256:before"]]);
    expect([...changedSinceCompleted(live(), atLoad)]).toEqual([]);
  });

  it("says nothing about a step that did not exist when the page loaded", () => {
    expect([...changedSinceCompleted(live(), new Map())]).toEqual([]);
  });

  it("says nothing before any content has been seen", () => {
    expect([...changedSinceCompleted(live(), undefined)]).toEqual([]);
  });
});

describe("control summary presentation", () => {
  function definition(overrides: Partial<ControlDetail> = {}): ControlDetail {
    return {
      control_id: "example-feature-01-risk-01-control-01",
      title: "Detect an example repackaging attempt",
      summary: "Detect an example repackaging attempt",
      intro: [{ type: "paragraph", text: "Detect an example repackaging attempt" }],
      ...overrides,
    } as ControlDetail;
  }

  it("hides the summary when the Description already supplied the title", () => {
    expect(controlSummary(definition())).toBeUndefined();
  });

  it("shows a summary that says more than the title", () => {
    expect(
      controlSummary(definition({ title: "Control 1", summary: "A longer placeholder summary." })),
    ).toBe("A longer placeholder summary.");
  });

  it("hides an intro that only repeats the summary", () => {
    expect(introRepeatsSummary(definition())).toBe(true);
  });

  it("keeps an intro that carries more than the summary", () => {
    const control = definition({
      intro: [
        { type: "paragraph", text: "Detect an example repackaging attempt" },
        { type: "paragraph", text: "Extra background the header does not show." },
      ],
    });
    expect(introRepeatsSummary(control)).toBe(false);
  });

  it("hides an empty intro", () => {
    expect(introRepeatsSummary(definition({ intro: [] }))).toBe(true);
  });
});
