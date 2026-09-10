// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceList } from "@/components/evidence";
import type { EvidenceItem } from "@/lib/evidence-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function artefacts(count: number, prefix = "file"): EvidenceItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `run:ref-${prefix}-${index}`,
    name: `${prefix}-${index}.json`,
    kind: "json",
    url: `/example/run?ref=ref-${prefix}-${index}`,
    downloadName: `${prefix}-${index}.json`,
    sizeBytes: 128,
    source: "Automated test",
  }));
}

let container: HTMLDivElement;
let root: Root;
let saved: { name: string; href: string }[];
let fetchMock: ReturnType<typeof vi.fn>;

function response(body: BodyInit, init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  saved = [];

  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:example/${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, href: this.href });
  });

  fetchMock = vi.fn(async () => response("example-bytes"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(items: EvidenceItem[]) {
  act(() => root.render(<EvidenceList items={items} />));
}

function names() {
  return [...container.querySelectorAll("li")].map(
    (row) => row.querySelector("span > span")?.textContent ?? "",
  );
}

function toggle() {
  return [...container.querySelectorAll("button")].find((button) =>
    /^Show /.test(button.textContent?.trim() ?? ""),
  );
}

function downloads() {
  return [...container.querySelectorAll<HTMLButtonElement>("button[aria-label^='Download ']")];
}

describe("the evidence rail", () => {
  it("says so when the run recorded nothing", () => {
    render([]);
    expect(container.textContent).toContain("No evidence recorded yet.");
    expect(toggle()).toBeUndefined();
  });

  it("shows five artefacts outright, with nothing to expand", () => {
    render(artefacts(5));
    expect(names()).toHaveLength(5);
    expect(toggle()).toBeUndefined();
  });

  it.each([
    [6, "Show 1 more artefact"],
    [8, "Show 3 more artefacts"],
  ])("shows five of %i and offers the rest as '%s'", (count, label) => {
    render(artefacts(count));

    expect(names()).toHaveLength(5);
    expect(toggle()?.textContent?.trim()).toBe(label);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("points the control at the list it opens", () => {
    render(artefacts(8));
    const listId = toggle()?.getAttribute("aria-controls");

    expect(listId).toBeTruthy();
    expect(document.getElementById(listId as string)?.tagName).toBe("UL");
  });

  it("reveals every remaining artefact, in the order the run gave them", () => {
    render(artefacts(8));
    const collapsed = names();
    act(() => toggle()?.click());

    expect(names()).toHaveLength(8);
    expect(names().slice(0, 5)).toEqual(collapsed);
    expect(names()[7]).toBe("file-7.json");
  });

  it("turns into a way back once it is open", () => {
    render(artefacts(8));
    act(() => toggle()?.click());

    const collapse = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Show fewer artefacts",
    );
    expect(collapse?.getAttribute("aria-expanded")).toBe("true");

    act(() => collapse?.click());
    expect(names()).toHaveLength(5);
    expect(names()).toEqual(artefacts(8).slice(0, 5).map((item) => item.name));
    expect(toggle()?.textContent?.trim()).toBe("Show 3 more artefacts");
  });

  it("is a real button a keyboard reaches, not an evidence row", () => {
    render(artefacts(8));
    const control = toggle()!;

    expect(control.tagName).toBe("BUTTON");
    expect(control.getAttribute("type")).toBe("button");
    expect(control.closest("li")).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(5);
  });

  it("gives a revealed artefact its own download, by handle and original name", async () => {
    render(artefacts(8));
    act(() => toggle()?.click());

    expect(downloads()).toHaveLength(8);
    const sixth = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Download file-5.json']",
    )!;
    await act(async () => sixth.click());

    expect(fetchMock).toHaveBeenCalledWith("/example/run?ref=ref-file-5");
    expect(saved).toEqual([{ name: "file-5.json", href: "blob:example/1" }]);
  });

  it("keeps a failed download to the artefact it belongs to, saving nothing", async () => {
    fetchMock.mockResolvedValue(
      response(JSON.stringify({ detail: "Evidence file not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    render(artefacts(8));
    act(() => toggle()?.click());

    const seventh = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Download file-6.json']",
    )!;
    await act(async () => seventh.click());

    expect(saved).toEqual([]);
    const failedRow = seventh.closest("li")!;
    expect(failedRow.textContent).toContain("Evidence file not found");
    expect(container.querySelectorAll("li")).toHaveLength(8);
    expect([...container.querySelectorAll("li")].filter((row) =>
      row.textContent?.includes("Evidence file not found"),
    )).toHaveLength(1);
  });

  it("keeps manual evidence reachable behind the same control", () => {
    const manual: EvidenceItem[] = [
      { id: "manual-1", name: "Reviewer note", kind: "text", source: "Security team" },
      { id: "manual-2", name: "Signed approval", kind: "text", source: "Security team" },
    ];
    render([...artefacts(7), ...manual]);

    expect(names()).toHaveLength(5);
    expect(toggle()?.textContent?.trim()).toBe("Show 4 more artefacts");

    act(() => toggle()?.click());
    expect(names()).toHaveLength(9);
    expect(container.textContent).toContain("Reviewer note");
    expect(container.textContent).toContain("Signed approval");
  });
});
