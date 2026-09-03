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
  images = [
    { path: "example/portrait.png", url: "/assets/example/portrait.png", caption: "Example caption." },
  ];
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
  it("keeps a screenshot small enough to sit beside its siblings", () => {
    render();
    expect(image().className).toContain("max-h-[15rem]");
    expect(image().className).toContain("max-w-[min(100%,13rem)]");
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
      expect(image().className, path).toContain("max-h-[15rem]");
      expect(image().className, path).toContain("max-w-[min(100%,13rem)]");
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

  it("can be opened at full size", () => {
    render();
    const trigger = image().closest("button") as HTMLButtonElement;
    expect(trigger.getAttribute("aria-label")).toContain("full size");
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

function navButtons() {
  const nav = container.querySelector("nav[aria-label='Manual testing steps']");
  return [...(nav?.querySelectorAll("button") ?? [])];
}

function buttonLabelled(label: string) {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  ) as HTMLButtonElement | undefined;
}

function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
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

  it("creates one sidebar entry per step, however many blocks they came from", () => {
    render();
    expect(navButtons()).toHaveLength(3);
  });

  it("numbers steps in one global order across every block", () => {
    render();
    expect(navButtons().map((b) => b.textContent)).toEqual(["1Step 1", "2Step 2", "3Step 3"]);
  });

  it("shows one step at a time", () => {
    render();
    expect(container.textContent).toContain("First step.");
    expect(container.textContent).not.toContain("Second step.");
    expect(container.textContent).not.toContain("Third step.");
  });

  it("marks the current step and only the current step", () => {
    render();
    const current = navButtons().filter((b) => b.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Step 1");
  });

  it("changes the active step when another is chosen, without leaving the route", () => {
    render();
    click(navButtons()[2]);

    const current = navButtons().filter((b) => b.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Step 3");
    expect(container.textContent).toContain("Third step.");
    expect(container.textContent).not.toContain("First step.");
  });

  it("moves forward with Next and back with Previous", () => {
    render();
    click(buttonLabelled("Next Step"));
    expect(container.textContent).toContain("Second step.");

    click(buttonLabelled("Previous"));
    expect(container.textContent).toContain("First step.");
  });

  it("cannot go back from the first step", () => {
    render();
    expect(buttonLabelled("Previous")?.disabled).toBe(true);
  });

  it("offers a way out rather than Next on the last step", () => {
    render();
    click(navButtons()[2]);
    expect(buttonLabelled("Next Step")).toBeUndefined();
    expect(container.textContent).toContain("Done");
  });

  it("keeps every navigation item reachable and focusable", () => {
    render();
    for (const button of navButtons()) {
      expect(button.className).toContain("focus-visible:ring");
      expect(button.className).toContain("min-h-[2.25rem]");
    }
  });

  it("scrolls the step list horizontally on small screens instead of overflowing", () => {
    render();
    const list = container.querySelector("nav[aria-label='Manual testing steps'] ol") as HTMLElement;
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("lg:flex-col");
    expect(list.className).toContain("[scrollbar-gutter:stable]");
  });

  it("keeps the setup table with the first step", () => {
    render();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.textContent).toContain("Placeholder");
  });

  it("still numbers steps that declare no id of their own", () => {
    blocks = [stepsBlock("example-block-one", [{ text: "Unnamed step." }, { text: "Another." }])];
    render();

    expect(navButtons()).toHaveLength(2);
    expect(container.textContent).toContain("Unnamed step.");
  });

  it("shows no navigation when the risk has no manual steps", () => {
    blocks = [];
    render();
    expect(container.querySelector("nav[aria-label='Manual testing steps']")).toBeNull();
    expect(container.textContent).toContain("haven't been written yet");
  });
});
