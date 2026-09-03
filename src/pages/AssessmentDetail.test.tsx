// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentStatus } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASSESSMENT = "example-assessment-id";
const APPLICATION = "example-app-id";

let assessmentStatus: AssessmentStatus = "queued";
let catalogue: { risk_id: string; name: string }[] = [];
let catalogueLoading = false;
let findings: { id: string; test_id: string; status: string }[] = [];

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
    useRiskCatalogue: () => ({ ...idle, isLoading: catalogueLoading, data: catalogue }),
    useFindings: () => ({ ...idle, data: findings }),
  };
});

const AssessmentDetail = (await import("@/pages/AssessmentDetail")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  assessmentStatus = "queued";
  catalogue = [];
  catalogueLoading = false;
  findings = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function LocationProbe() {
  const location = useLocation();
  return <span data-location={location.pathname + location.search} />;
}

function render() {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[`/assessments/${ASSESSMENT}`]}>
        <Routes>
          <Route path="/assessments" element={<span data-assessments-page />} />
          <Route path="/assessments/:assessmentId" element={<AssessmentDetail />} />
          <Route
            path="/assessments/:assessmentId/tests/:testId"
            element={<span data-risk-page />}
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    ),
  );
}

function path() {
  return container.querySelector("[data-location]")?.getAttribute("data-location");
}

function text() {
  return container.textContent ?? "";
}

describe("an incomplete assessment", () => {
  it("redirects to the main Assessments page rather than narrating setup here", () => {
    for (const status of ["queued", "waiting", "running", "failed"] as const) {
      assessmentStatus = status;
      render();

      expect(path(), status).toBe(`/assessments?expanded=${ASSESSMENT}`);
      expect(container.querySelector("[data-assessments-page]"), status).not.toBeNull();
      act(() => root.unmount());
      root = createRoot(container);
    }
  });
});

describe("opening a completed assessment", () => {
  beforeEach(() => {
    assessmentStatus = "completed";
    catalogue = [
      { risk_id: "example-feature-01-risk-01", name: "Example Risk One" },
      { risk_id: "example-feature-01-risk-02", name: "Example Risk Two" },
    ];
  });

  it("opens the feature-risk that still needs a decision", () => {
    findings = [
      { id: "f1", test_id: "example-feature-01-risk-01", status: "reduced_risk" },
      { id: "f2", test_id: "example-feature-01-risk-02", status: "at_risk" },
    ];
    render();

    expect(path()).toBe(`/assessments/${ASSESSMENT}/tests/example-feature-01-risk-02`);
    expect(container.querySelector("[data-risk-page]")).not.toBeNull();
  });

  it("opens the first catalogue risk when nothing has been tested", () => {
    render();
    expect(path()).toBe(`/assessments/${ASSESSMENT}/tests/example-feature-01-risk-01`);
  });

  it("escapes the risk id rather than trusting it in the path", () => {
    catalogue = [{ risk_id: "example/risk", name: "Example" }];
    render();
    expect(path()).toContain("%2F");
  });

  it("waits for the catalogue instead of deciding there are no risks", () => {
    catalogueLoading = true;
    catalogue = [];
    render();

    expect(path()).toBe(`/assessments/${ASSESSMENT}`);
    expect(text()).toContain("Opening the assessment…");
  });

  it("says so deliberately when the assessment genuinely has no risks", () => {
    catalogue = [];
    render();

    expect(path()).toBe(`/assessments/${ASSESSMENT}`);
    expect(text()).toContain("Assessment complete");
    expect(text()).toContain("No security tests are available");
  });

  it("never leaves the main pane blank, whatever the catalogue is doing", () => {
    for (const loading of [true, false]) {
      catalogueLoading = loading;
      catalogue = loading ? [] : [];
      render();

      expect(text().trim().length > 0, String(loading)).toBe(true);
      act(() => root.unmount());
      root = createRoot(container);
    }
  });
});
