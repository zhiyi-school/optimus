// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssessmentSidebar } from "@/components/assessment-sidebar";
import type { RiskDefinition } from "@/api/automation-types";
import type { Application, Assessment, Finding } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASSESSMENT = "example-assessment-id";

const application = { id: "example-app-id", name: "Example Application", platform: "ios" } as Application;

function assessment(completed: number, total: number): Assessment {
  return {
    id: ASSESSMENT,
    application_id: "example-app-id",
    status: "completed",
    total_tests: total,
    completed_tests: completed,
  } as Assessment;
}

function risk(riskId: string, name: string): RiskDefinition {
  return { risk_id: riskId, name } as RiskDefinition;
}

function findings(...entries: { testId: string; status: string }[]) {
  return new Map(
    entries.map(({ testId, status }) => [
      testId,
      { id: `f-${testId}`, test_id: testId, status } as Finding & { application: Application | null },
    ]),
  );
}

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

function render(
  stored: Assessment,
  risks: RiskDefinition[] | undefined,
  findingByTestId: ReturnType<typeof findings> = new Map(),
) {
  act(() =>
    root.render(
      <MemoryRouter>
        <AssessmentSidebar
          application={application}
          assessment={stored}
          risks={risks}
          findingByTestId={findingByTestId}
        />
      </MemoryRouter>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

describe("the assessment sidebar's progress", () => {
  const catalogue = [
    risk("risk-1", "Example Risk One"),
    risk("risk-2", "Example Risk Two"),
    risk("risk-3", "Example Risk Three"),
  ];

  it("reports the coverage the backend stored, not what this page can see", () => {
    // Only one of the three catalogue risks has a finding here, but the backend
    // counted twelve across every run of this application.
    render(assessment(12, 12), catalogue, findings({ testId: "risk-1", status: "at_risk" }));

    expect(text()).toContain("12 of 12 risks tested");
    expect(text()).not.toContain("1 of 3");
    expect(text()).not.toContain("tests completed");
  });

  it("still reports the stored coverage when nothing on this page has a finding", () => {
    render(assessment(12, 12), catalogue);
    expect(text()).toContain("12 of 12 risks tested");
  });

  it("reports a partly covered application as the backend counted it", () => {
    render(assessment(5, 12), catalogue, findings({ testId: "risk-1", status: "at_risk" }));
    expect(text()).toContain("5 of 12 risks tested");
  });

  it("reports nothing tested when the backend counted nothing", () => {
    render(assessment(0, 12), catalogue);
    expect(text()).toContain("0 of 12 risks tested");
  });

  it("still lists the catalogue risks alongside the stored count", () => {
    render(assessment(12, 12), catalogue, findings({ testId: "risk-2", status: "reduced_risk" }));

    expect(text()).toContain("Example Risk One");
    expect(text()).toContain("Example Risk Three");
  });

  it("reports the stored count even with no catalogue to list", () => {
    render(assessment(4, 12), undefined);
    expect(text()).toContain("4 of 12 risks tested");
  });
});
