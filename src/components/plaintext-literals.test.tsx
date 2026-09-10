// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaintextLiteralsCard } from "@/components/plaintext-literals";
import { plaintextLiterals, type PlaintextAnalysis } from "@/lib/plaintext-literals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RUN = "2026-01-02_00-00-00";

function analysisOf(findings: unknown[], overrides: Record<string, unknown> = {}): PlaintextAnalysis {
  return plaintextLiterals(
    {
      analysis_provider: "builtin",
      sensitive_scan: { enabled: true },
      sensitive_information_findings: findings,
      ...overrides,
    },
    RUN,
  );
}

const plistKey = {
  path: "Example-Info.plist",
  key_path: "$.API_KEY",
  match_type: "GOOGLE_API_KEY",
  masked_value: "AIza...0000",
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

function render(props: Partial<Parameters<typeof PlaintextLiteralsCard>[0]> = {}) {
  act(() =>
    root.render(
      <MemoryRouter>
        <PlaintextLiteralsCard analysis={analysisOf([plistKey])} {...props} />
      </MemoryRouter>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

function rows() {
  return [...container.querySelectorAll("tbody tr")];
}

describe("the exposed plaintext literals card", () => {
  it("names itself and counts what it found", () => {
    render();
    expect(text()).toContain("Exposed plaintext literals");
    expect(text()).toContain("1 literal");
  });

  it("shows exactly category, location and value", () => {
    render();
    const headers = [...container.querySelectorAll("th")].map((cell) => cell.textContent?.trim());
    expect(headers).toEqual(["Category", "Location", "Value"]);
    expect(rows()[0].querySelectorAll("td")).toHaveLength(3);
  });

  it("shows the category, location and masked value for each literal", () => {
    render();
    const row = rows()[0].textContent ?? "";

    expect(row).toContain("Potential hardcoded secret key");
    expect(row).toContain("Example-Info.plist");
    expect(row).toContain("$.API_KEY");
    expect(row).toContain("AIza...0000");
  });

  it("no longer explains why each literal was flagged", () => {
    render();
    expect(text()).not.toContain("Why it was flagged");
    expect(text()).not.toContain("Matches the Google API key format");
  });

  it("says where the run and provider came from, and that matches are unconfirmed", () => {
    render();
    expect(text()).toContain("builtin");
    expect(text()).toContain(RUN);
    expect(text()).toContain("not confirmed to be valid");
  });

  it("shows an analyzer-only match as such rather than as a bundle file", () => {
    render({ analysis: analysisOf([{ ...plistKey, path: "mobsf_report_json" }], { analysis_provider: "mobsf" }) });
    expect(text()).toContain("no bundle file recorded");
    expect(text()).not.toContain("mobsf_report_json");
  });

  it("keeps the fix link, now beneath the category", () => {
    render({ controlHref: (id) => `/resolve/findings/example/controls/${id}` });
    const link = container.querySelector("a")!;

    expect(link.textContent).toBe("How to fix");
    expect(link.getAttribute("href")).toBe(
      "/resolve/findings/example/controls/ios-feature-01-risk-01-control-02",
    );
    expect(link.closest("td")).toBe(rows()[0].querySelectorAll("td")[0]);
  });

  it("offers no link when no reliable control mapping exists", () => {
    render({
      analysis: analysisOf([{ ...plistKey, path: "mobsf_report_json" }]),
      controlHref: (id) => `/x/${id}`,
    });
    expect(container.querySelector("a")).toBeNull();
  });

  it("says nothing matched when the scan ran and found none", () => {
    render({ analysis: analysisOf([]) });
    expect(text()).toContain("No matching plaintext literals reported in this run.");
    expect(container.querySelector("table")).toBeNull();
  });

  it("says the results are unknown when the scan did not run", () => {
    render({ analysis: analysisOf([], { sensitive_scan: { enabled: false } }) });
    expect(text()).toContain("did not run");
    expect(text()).not.toContain("No matching plaintext literals");
  });

  it("says so for an analysis it cannot read, rather than claiming none", () => {
    render({ analysis: plaintextLiterals("not a report", RUN) });
    expect(text()).toContain("did not record structured plaintext-literal analysis");
    expect(text()).not.toContain("No matching plaintext literals");
  });

  it("reports a failed request as unknown, with a retry", () => {
    const retry = vi.fn();
    render({ analysis: undefined, isError: true, onRetry: retry });

    expect(text()).toContain("could not be loaded");
    expect(text()).not.toContain("No matching plaintext literals");
    act(() => container.querySelector("button")?.click());
    expect(retry).toHaveBeenCalled();
  });

  it("says so when the risk has no analysis at all, rather than showing an empty card", () => {
    render({ analysis: undefined });

    expect(text()).toContain("No static analysis is available for this risk yet");
    expect(text()).not.toContain("No matching plaintext literals");
    expect(container.querySelector("table")).toBeNull();
  });

  it("shows a loading state rather than an empty verdict", () => {
    render({ analysis: undefined, isLoading: true });
    expect(text()).toContain("Loading plaintext literals…");
    expect(text()).not.toContain("No matching plaintext literals");
  });

  it("passes on a declared truncation", () => {
    render({ analysis: analysisOf([plistKey], { sensitive_scan: { enabled: true, truncated: true } }) });
    expect(text()).toContain("truncated");
  });

  it("wraps a long masked value inside its own scrolling box", () => {
    render();
    expect(container.querySelector("code")?.className).toContain("break-all");
    expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
  });

  it("escapes analyzer strings rather than rendering them as markup", () => {
    render({
      analysis: analysisOf([
        { ...plistKey, path: "<img src=x onerror=alert(1)>", masked_value: "<script>alert(2)</script>" },
      ]),
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(text()).toContain("<img src=x onerror=alert(1)>");
  });
});
