// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CriticalFindingsTable } from "@/components/critical-findings";
import { parseCriticalFindings } from "@/lib/critical-findings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = {
  status: "RISK_EXISTS",
  highest_severity: "HIGH",
  flags: [
    {
      id: "EXAMPLE_HIGH",
      severity: "HIGH",
      title: "Potential sensitive information is present",
      evidence: ["HIGH EXAMPLE_KEY in Example.plist: $.KEY = example-value"],
      recommendation: "Move the value out of the bundle.",
    },
    {
      id: "EXAMPLE_LOW",
      severity: "LOW",
      title: "Native framework dependencies are visible",
      evidence: ["Frameworks: 2"],
      recommendation: "",
    },
  ],
};

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
  vi.restoreAllMocks();
});

function render(props: Partial<Parameters<typeof CriticalFindingsTable>[0]> = {}) {
  act(() =>
    root.render(<CriticalFindingsTable findings={parseCriticalFindings(report)} {...props} />),
  );
}

function text() {
  return container.textContent ?? "";
}

function buttonNamed(label: string) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

function rows() {
  return [...container.querySelectorAll("tbody tr")];
}

describe("the static-analysis table", () => {
  it("gives each finding a severity, a title and its details", () => {
    render();
    const header = [...container.querySelectorAll("th")].map((cell) => cell.textContent?.trim());
    expect(header).toContain("Severity");
    expect(header).toContain("Finding");
    expect(header).toContain("Evidence");

    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain("HIGH");
    expect(rows()[0].textContent).toContain("Potential sensitive information is present");
    expect(rows()[0].textContent).toContain("$.KEY = example-value");
  });

  it("reports the finding count and the highest severity", () => {
    render();
    expect(text()).toContain("2 findings");
    expect(text()).toContain("highest");
  });

  it("filters to one severity and back again", () => {
    render();
    act(() => buttonNamed("LOW (1)")?.click());
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Native framework dependencies");

    act(() => buttonNamed("LOW (1)")?.click());
    expect(rows()).toHaveLength(2);
  });

  it("marks the active filter for a screen reader", () => {
    render();
    expect(buttonNamed("All (2)")?.getAttribute("aria-pressed")).toBe("true");
    act(() => buttonNamed("HIGH (1)")?.click());
    expect(buttonNamed("HIGH (1)")?.getAttribute("aria-pressed")).toBe("true");
    expect(buttonNamed("All (2)")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("says so when a filter leaves nothing", () => {
    render({ findings: parseCriticalFindings({ ...report, flags: [report.flags[0]] }) });
    act(() => buttonNamed("HIGH (1)")?.click());
    expect(rows()).toHaveLength(1);
  });

  it("escapes evidence rather than rendering it as markup", () => {
    render({
      findings: parseCriticalFindings({
        ...report,
        flags: [
          {
            id: "EXAMPLE_XSS",
            severity: "HIGH",
            title: "<img src=x onerror=alert(1)>",
            evidence: ["<script>alert(2)</script>"],
            recommendation: "<b>bold</b>",
          },
        ],
      }),
    });

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(text()).toContain("<script>alert(2)</script>");
    expect(text()).toContain("<img src=x onerror=alert(1)>");
  });

  it("wraps a long evidence string instead of scrolling the page sideways", () => {
    render();
    const cell = container.querySelector("code")!;
    expect(cell.className).toContain("break-all");
    expect(cell.className).toContain("whitespace-pre-wrap");
    expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
  });

  it("copies one detail line without reformatting it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render();

    const copy = container.querySelector<HTMLButtonElement>(
      "button[aria-label^='Copy detail 1']",
    )!;
    await act(async () => copy.click());

    expect(writeText).toHaveBeenCalledWith(
      "HIGH EXAMPLE_KEY in Example.plist: $.KEY = example-value",
    );
  });

  it("copies a whole finding from the same data the table shows", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render();

    const copy = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Copy Potential sensitive information is present']",
    )!;
    await act(async () => copy.click());

    expect(writeText).toHaveBeenCalledWith(
      [
        "HIGH: Potential sensitive information is present",
        "  - HIGH EXAMPLE_KEY in Example.plist: $.KEY = example-value",
        "  Recommendation: Move the value out of the bundle.",
      ].join("\n"),
    );
  });

  it("offers the run's own JSON and Markdown exports", () => {
    render({ jsonUrl: "/example/json", markdownUrl: "/example/md" });
    expect(buttonNamed("Download JSON")).toBeDefined();
    expect(buttonNamed("Download Markdown")).toBeDefined();
  });

  it("offers no export the run does not have", () => {
    render({ jsonUrl: "/example/json" });
    expect(buttonNamed("Download JSON")).toBeDefined();
    expect(buttonNamed("Download Markdown")).toBeUndefined();
  });

  it("shows nothing at all when the run recorded no findings", () => {
    render({ findings: undefined });
    expect(container.querySelector("table")).toBeNull();
  });

  it("says the analysis could not be loaded, with a retry", () => {
    const retry = vi.fn();
    render({ findings: undefined, isError: true, onRetry: retry });

    expect(text()).toContain("could not provide this run's static analysis");
    act(() => container.querySelector("button")?.click());
    expect(retry).toHaveBeenCalled();
  });

  it("shows a loading state rather than an empty table", () => {
    render({ findings: undefined, isLoading: true });
    expect(text()).toContain("Loading static analysis…");
  });
});
