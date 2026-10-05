// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, Assessment } from "@/database/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/assessment/new-version-dialog", () => ({
  NewVersionDialog: ({ open }: { open: boolean }) => (open ? <p>version dialog open</p> : null),
}));

const { AssessmentHistory } = await import("@/components/assessment/assessment-history");

const application = { id: "app-id", name: "Example App", platform: "ios" } as Application;

function assessment(id: string, created_at: string, overrides: Partial<Assessment> = {}): Assessment {
  return {
    id,
    external_id: `run::${id}`,
    application_id: "app-id",
    status: "completed",
    total_tests: 5,
    completed_tests: 5,
    created_at,
    updated_at: created_at,
    app_version: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

function render(assessments: Assessment[], mayStart: boolean, current = "older") {
  act(() =>
    root.render(
      <MemoryRouter>
        <AssessmentHistory
          application={application}
          currentAssessmentId={current}
          assessments={assessments}
          mayStart={mayStart}
        />
      </MemoryRouter>,
    ),
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const both = [
  assessment("older", "2026-01-01T00:00:00Z", { app_version: "3.9.9" }),
  assessment("newer", "2026-02-01T00:00:00Z", { app_version: "4.3.4" }),
];

describe("the app's assessments", () => {
  it("lists them newest first with the version each tested, marking the open one", () => {
    render(both, false);

    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/assessments/newer", "/assessments/older"]);
    expect(links[0].textContent).toContain("Version 4.3.4");
    expect(links[1].textContent).toContain("Version 3.9.9");
    expect(links[1].getAttribute("aria-current")).toBe("page");
  });

  it("says when an assessment recorded no version", () => {
    render([assessment("older", "2026-01-01T00:00:00Z"), assessment("x", "2026-01-02T00:00:00Z")], false);

    expect(container.textContent).toContain("Version not recorded");
  });

  it("offers a new version only when one may be started, opening the picker", () => {
    render(both, true);
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Assess a new version"))!;

    act(() => button.click());

    expect(container.textContent).toContain("version dialog open");
  });

  it("offers nothing when a new assessment may not start", () => {
    render(both, false);

    expect(container.textContent).not.toContain("Assess a new version");
  });

  it("stays out of the way for an app with one assessment and nothing to start", () => {
    render([assessment("older", "2026-01-01T00:00:00Z")], false);

    expect(container.textContent).toBe("");
  });

  it("caps a long history at the five newest, keeping the open one, until shown in full", () => {
    const many = Array.from({ length: 8 }, (_, i) => assessment(`a${i}`, `2026-01-0${i + 1}T00:00:00Z`));
    render(many, false, "a0");
    const hrefs = () => [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    const toggle = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Show"))!;

    expect(hrefs()).toEqual(["a7", "a6", "a5", "a4", "a3", "a0"].map((id) => `/assessments/${id}`));
    expect(toggle().textContent).toBe("Show all 8");

    act(() => toggle().click());
    expect(hrefs()).toHaveLength(8);
    expect(toggle().textContent).toBe("Show fewer");

    act(() => toggle().click());
    expect(hrefs()).toHaveLength(6);
  });

  it("needs no toggle for a short history", () => {
    render(both, false);

    expect(container.textContent).not.toContain("Show all");
  });
});
