// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemonstrationImage } from "@/api/automation-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASSESSMENT = "example-assessment-id";
const RISK = "example-feature-01-risk-01";

let images: DemonstrationImage[] = [];
let blocks: unknown[] | null = null;

function stepsBlock(id: string, items: { id?: string; text: string }[]) {
  return { id, type: "steps", items: items.map((item) => ({ ...item, images: [] })) };
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/hooks/queries", () => ({
  useAssessment: () => ({
    data: { id: ASSESSMENT, application: { platform: "ios" } },
    isLoading: false,
  }),
  useRiskCatalogue: () => ({
    data: [
      {
        risk_id: RISK,
        name: "Example Risk",
        goal: "Example goal.",
        demonstration: blocks ?? [
          {
            id: "example-block",
            type: "steps",
            items: [{ id: "example-step", text: "Example step text.", images }],
          },
        ],
      },
    ],
    isLoading: false,
  }),
}));

const ManualTestSteps = (await import("@/pages/ManualTestSteps")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  images = [{ path: "example/portrait.png", url: "/assets/example/portrait.png", caption: "Example caption." }];
  blocks = null;
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
      <MemoryRouter initialEntries={[`/assessments/${ASSESSMENT}/tests/${RISK}/manual`]}>
        <Routes>
          <Route path="/assessments/:assessmentId/tests/:testId/manual" element={<ManualTestSteps />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function image() {
  return container.querySelector("img") as HTMLImageElement;
}

describe("manual-test screenshots", () => {
  it("caps how much of the page a screenshot can take", () => {
    render();
    expect(image().className).toContain("max-h-[32rem]");
    expect(image().className).toContain("max-w-[min(100%,42rem)]");
  });

  it("stays inside a narrow screen", () => {
    render();
    expect(image().className).toContain("100%");
    expect(image().className).not.toContain("w-full");
  });

  it("scales rather than stretching or cropping", () => {
    render();
    expect(image().className).toContain("object-contain");
    expect(image().className).toContain("h-auto");
    expect(image().className).toContain("w-auto");
    expect(image().className).not.toContain("object-cover");
  });

  it("constrains portrait and landscape screenshots the same way", () => {
    for (const path of ["example/portrait.png", "example/landscape.png"]) {
      images = [{ path, url: `/assets/${path}`, caption: "Example caption." }];
      render();
      expect(image().className, path).toContain("max-h-[32rem]");
      expect(image().className, path).toContain("max-w-[min(100%,42rem)]");
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it("keeps the caption attached to the rendered image, not the column", () => {
    render();
    const figure = container.querySelector("figure") as HTMLElement;
    expect(figure.className).toContain("w-fit");
    expect(figure.querySelector("figcaption")?.textContent).toContain("Example caption.");
  });

  it("still falls back when the screenshot is missing", () => {
    images = [{ path: "example/missing.png", exists: false, caption: "Example caption." }];
    render();

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Example caption.");
  });

  it("still offers the way back to the test", () => {
    render();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(`/assessments/${ASSESSMENT}/tests/${RISK}`);
  });
});

function navLinks() {
  const nav = container.querySelector("nav[aria-label='Manual testing steps']");
  return [...(nav?.querySelectorAll("a") ?? [])];
}

describe("manual-test step navigation", () => {
  beforeEach(() => {
    blocks = [
      stepsBlock("example-block-one", [
        { id: "example-step-a", text: "First step." },
        { id: "example-step-b", text: "Second step." },
      ]),
      { id: "example-table", type: "table", rows: [{ Setting: "Example", Value: "Placeholder" }] },
      stepsBlock("example-block-two", [{ id: "example-step-c", text: "Third step." }]),
    ];
  });

  it("creates one sidebar entry per step", () => {
    render();
    expect(navLinks()).toHaveLength(3);
  });

  it("numbers steps in one global order across every block", () => {
    render();
    expect(navLinks().map((link) => link.textContent)).toEqual(["Step 1", "Step 2", "Step 3"]);
  });

  it("gives each step a unique anchor its link points at", () => {
    render();
    const targets = navLinks().map((link) => link.getAttribute("href"));
    expect(targets).toEqual(["#manual-step-1", "#manual-step-2", "#manual-step-3"]);
    expect(new Set(targets).size).toBe(3);
    for (const target of targets) {
      expect(container.querySelector(target!.replace("#", "#"))).not.toBeNull();
    }
  });

  it("renders the numbered step bodies in the same global order", () => {
    render();
    const anchors = [...container.querySelectorAll("[id^='manual-step-']")];
    expect(anchors.map((node) => node.id)).toEqual([
      "manual-step-1",
      "manual-step-2",
      "manual-step-3",
    ]);
    expect(anchors[2].textContent).toContain("Third step.");
  });

  it("marks the current step and only the current step", () => {
    render();
    const current = navLinks().filter((link) => link.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("Step 1");
  });

  it("moves the current marker when another step is chosen, without leaving the route", () => {
    render();
    act(() => navLinks()[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

    const current = navLinks().filter((link) => link.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("Step 3");
    expect(container.textContent).toContain("Third step.");
  });

  it("keeps every navigation item reachable and focusable", () => {
    render();
    for (const link of navLinks()) {
      expect(link.className).toContain("focus-visible:ring");
      expect(link.className).toContain("min-h-[2.25rem]");
    }
  });

  it("reserves scrollbar space so the gutter never sits over a step name", () => {
    render();
    const list = container.querySelector("nav[aria-label='Manual testing steps'] ul") as HTMLElement;
    expect(list.className).toContain("[scrollbar-gutter:stable]");
    expect(list.className).toContain("lg:pr-3");
    expect(list.className).toContain("lg:overflow-y-auto");
  });

  it("scrolls horizontally on small screens instead of overflowing the page", () => {
    render();
    const list = container.querySelector("nav[aria-label='Manual testing steps'] ul") as HTMLElement;
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("lg:flex-col");
  });

  it("keeps the setup table alongside the steps", () => {
    render();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.textContent).toContain("Placeholder");
  });

  it("falls back to positional anchors when a step declares no id", () => {
    blocks = [stepsBlock("example-block-one", [{ text: "Unnamed step." }, { text: "Another." }])];
    render();

    expect(navLinks().map((link) => link.getAttribute("href"))).toEqual([
      "#manual-step-1",
      "#manual-step-2",
    ]);
  });

  it("shows no navigation when the risk has no manual steps", () => {
    blocks = [];
    render();
    expect(container.querySelector("nav[aria-label='Manual testing steps']")).toBeNull();
  });
});
