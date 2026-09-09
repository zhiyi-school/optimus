// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import fixtureJson from "@/test-fixtures/playbook-control-v1.json";
import { ControlStepBody } from "@/components/control-content";
import { PlaybookContent } from "@/components/playbook-content";
import type { ControlDetail } from "@/api/playbook-types";
import { selectedControlReconciliationPlan } from "@/lib/resolve";

const fixture = fixtureJson as ControlDetail;
let container: HTMLDivElement | undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => container?.remove());

describe("backend playbook contract fixture", () => {
  it("renders parsed content and preserves transport identities", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() =>
      root.render(
        <>
          <PlaybookContent blocks={fixture.intro} />
          {fixture.steps.map((step, index) => (
            <ControlStepBody key={step.step_key} step={step} index={index} />
          ))}
        </>,
      ),
    );

    expect(container.textContent).toContain("Use the synthetic control");
    expect(container.textContent).toContain("example --check");
    expect(container.querySelector("img")?.getAttribute("src")).toContain("attachments/example.svg");
    expect(fixture.steps.map(({ step_key, content_hash }) => ({ step_key, content_hash }))).toEqual([
      { step_key: "keep-stable-setting", content_hash: "sha256:859566a674fcabdb9cb2d6e4aa8f098f" },
      { step_key: "auto-cda458c3a785", content_hash: "sha256:8cbcddf02a90f1851f292379865462ac" },
    ]);
    expect(selectedControlReconciliationPlan(fixture)).toEqual([
      { control_id: fixture.control_id, step_keys: ["keep-stable-setting", "auto-cda458c3a785"] },
    ]);

    act(() => root.unmount());
  });
});
