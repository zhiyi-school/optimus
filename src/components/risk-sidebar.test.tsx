// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RiskSidebar, type RiskSidebarEntry } from "@/components/risk-sidebar";
import type { Application } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG_NAME =
  "Example Application With A Deliberately Very Long Name That Cannot Fit On One Line";

const application = {
  id: "example-app-id",
  external_id: "example_app",
  name: "Example Application",
  platform: "ios",
  version: "1.4.2",
  app_type: null,
  icon_ref: null,
  icon_extraction_status: null,
} as unknown as Application;

const entries: RiskSidebarEntry[] = [
  { riskId: "example-feature-01-risk-01", name: "Example Risk One", status: "at_risk" },
  { riskId: "example-feature-01-risk-02", name: "Example Risk Two", status: "reduced_risk" },
  { riskId: "example-feature-01-risk-03", name: "Example Risk Three" },
];

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

function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-location={pathname} />;
}

function render(overrides: Partial<Parameters<typeof RiskSidebar>[0]> = {}) {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route
            path="*"
            element={
              <RiskSidebar
                backTo="/assessments"
                backLabel="Back to Assessments"
                application={application}
                progress={{ completed: 5, total: 8, label: "tests completed" }}
                risks={entries}
                activeRiskId="example-feature-01-risk-01"
                riskHref={(id) => `/assessments/example-assessment-id/tests/${id}`}
                emptyMessage="No test catalogue was returned."
                {...overrides}
              />
            }
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    ),
  );
}

function rows() {
  return [...container.querySelectorAll("#risk-sidebar-list button")] as HTMLButtonElement[];
}

function path() {
  return container.querySelector("[data-location]")?.getAttribute("data-location");
}

function listClasses() {
  const list = container.querySelector("#risk-sidebar-list") as HTMLElement;
  return [...list.classList];
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

describe("the shared risk sidebar", () => {
  it("names the application, its version and its platform at the top", () => {
    render();
    expect(container.textContent).toContain("Example Application");
    expect(container.textContent).toContain("Version 1.4.2");
    expect(container.textContent).toContain("iOS");
  });

  it("puts progress directly below the application, above the risk rows", () => {
    render();
    expect(container.textContent).toContain("5 of 8 tests completed");
  });

  it("marks the active risk, and only the active risk", () => {
    render();
    const current = rows().filter((row) => row.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Example Risk One");
  });

  it("follows the route rather than its own state", () => {
    render({ activeRiskId: "example-feature-01-risk-03" });
    const current = rows().filter((row) => row.getAttribute("aria-current") === "page");
    expect(current[0].textContent).toContain("Example Risk Three");
  });

  it("activates from anywhere in the row, including its badge", () => {
    render();
    const badge = [...rows()[1].querySelectorAll("*")].find(
      (node) => node.textContent?.trim() === "Reduced Risk",
    );
    click(badge!);
    expect(path()).toBe("/assessments/example-assessment-id/tests/example-feature-01-risk-02");
  });

  it("is one keyboard-reachable control per risk, with nothing interactive nested inside", () => {
    render();
    expect(rows()).toHaveLength(3);
    for (const row of rows()) {
      expect(row.tagName).toBe("BUTTON");
      expect(row.className).toContain("focus-visible:ring");
      expect(row.querySelector("a, button, input, select, textarea")).toBeNull();
    }
  });

  it("falls back to Not Tested rather than inventing a classification", () => {
    render();
    expect(rows()[2].textContent).toContain("Not Tested");
  });

  it("wraps a long risk name to two lines instead of truncating it away", () => {
    render({ risks: [{ riskId: "r", name: LONG_NAME, status: "at_risk" }] });
    const label = rows()[0].querySelector("span");
    expect(label?.className).toContain("line-clamp-2");
    expect(rows()[0].textContent).toContain("Deliberately Very Long Name");
  });

  it("keeps a long application name inside the sidebar", () => {
    render({ application: { ...application, name: LONG_NAME } });
    const name = [...container.querySelectorAll("p")].find((p) => p.textContent === LONG_NAME);
    expect(name?.className).toContain("truncate");
  });

  it("scrolls only the risk list, and reserves the gutter so it covers nothing", () => {
    render();
    const list = container.querySelector("#risk-sidebar-list") as HTMLElement;
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("[scrollbar-gutter:stable]");
    expect(list.className).toContain("overflow-x-hidden");
  });

  it("bounds the list height so many risks cannot lengthen the page", () => {
    render({
      risks: Array.from({ length: 40 }, (_, index) => ({
        riskId: `risk-${index}`,
        name: `Example Risk ${index}`,
        status: "at_risk" as const,
      })),
    });
    const list = container.querySelector("#risk-sidebar-list") as HTMLElement;
    expect(list.className).toContain("max-h-[22rem]");
    expect(list.className).toContain("lg:max-h-[calc(100vh-19rem)]");
  });

  it("stays visible beside the detail pane on a desktop", () => {
    render();
    expect((container.firstElementChild as HTMLElement).className).toContain("lg:sticky");
  });

  it("collapses into an accordion on small screens, and says what is open", () => {
    render();
    const toggle = container.querySelector("[aria-controls='risk-sidebar-list']") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(listClasses()).toContain("hidden");
    expect(toggle.textContent).toContain("Example Risk One");

    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(listClasses()).not.toContain("hidden");
    expect(listClasses()).toContain("lg:block");
  });

  it("offers the way back where it came from", () => {
    render();
    const back = container.querySelector("a") as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("/assessments");
    expect(back.textContent).toContain("Back to Assessments");
  });

  it("explains an empty catalogue instead of showing an empty box", () => {
    render({ risks: [] });
    expect(container.textContent).toContain("No test catalogue was returned.");
    expect(container.querySelector("#risk-sidebar-list")).toBeNull();
  });
});

describe("both roles use the one sidebar", () => {
  it("is the only master column either workspace builds", () => {
    for (const path of ["src/pages/TestDetail.tsx", "src/pages/ResolveRisk.tsx"]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toMatch(/AssessmentSidebar|RiskSidebar/);
      expect(source, path).toContain("RiskWorkspace");
    }
  });

  it("reaches the developer's sidebar through the same component security uses", () => {
    const adapter = readFileSync("src/components/assessment-sidebar.tsx", "utf8");
    expect(adapter).toContain('from "@/components/risk-sidebar"');
    expect(adapter).toContain("<RiskSidebar");
  });

  it("gives both roles the same workspace geometry", () => {
    const workspace = readFileSync("src/components/risk-workspace.tsx", "utf8");
    expect(workspace).toContain("lg:grid-cols-[17rem_minmax(0,1fr)]");
    for (const path of ["src/pages/TestDetail.tsx", "src/pages/ResolveRisk.tsx"]) {
      expect(readFileSync(path, "utf8"), path).not.toContain("lg:grid-cols-3");
    }
  });
});
