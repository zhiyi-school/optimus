// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataTable, type DataTableColumn, type DataTableRowActivation } from "@/components/data-display";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Row {
  id: string;
  name: string;
  status: string;
}

const ROWS: Row[] = [
  { id: "assessment-queued", name: "Example Application A", status: "queued" },
  { id: "assessment-waiting", name: "Example Application B", status: "waiting" },
  { id: "assessment-done", name: "Example Application C", status: "completed" },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "name", header: "Application", render: (row) => row.name },
  { key: "status", header: "Status", render: (row) => row.status },
];

const activationByStatus = (row: Row): DataTableRowActivation =>
  row.status === "completed" ? "navigate" : "expand";

let container: HTMLDivElement;
let root: Root;
let opened: string[];
let toggled: string[];
let deleted: string[];

beforeEach(() => {
  opened = [];
  toggled = [];
  deleted = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function rows() {
  return [...container.querySelectorAll("tbody tr")];
}

function rowFor(id: string) {
  const index = ROWS.findIndex((row) => row.id === id);
  return rows()[index];
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function press(element: Element, key: string) {
  act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}

function renderGated(expandedRowId: string | null = null) {
  act(() =>
    root.render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        onRowClick={(row) => opened.push(row.id)}
        rowLabel={(row) => `Open the assessment for ${row.name}`}
        rowActivation={activationByStatus}
        expandLabel={(row) => `View setup and testing status for ${row.name}`}
        expandedRowId={expandedRowId}
        onToggleExpand={(row) => toggled.push(row.id)}
        renderExpanded={(row) => (
          <div>
            <p>Setup progress for {row.name}</p>
            <button type="button" onClick={(e) => { e.stopPropagation(); deleted.push(row.id); }}>
              Retry
            </button>
          </div>
        )}
      />,
    ),
  );
}

describe("rowActivation: expand (an incomplete assessment row)", () => {
  it("toggles on a click anywhere on the row", () => {
    renderGated();
    click(rowFor("assessment-queued"));
    expect(toggled).toEqual(["assessment-queued"]);
    expect(opened).toEqual([]);
  });

  it("never opens assessment results", () => {
    renderGated();
    click(rowFor("assessment-queued"));
    click(rowFor("assessment-waiting"));
    expect(opened).toEqual([]);
  });

  it("collapses again on a second click", () => {
    renderGated("assessment-queued");
    click(rowFor("assessment-queued"));
    expect(toggled).toEqual(["assessment-queued"]);
  });

  it("toggles with Enter and Space", () => {
    renderGated();
    press(rowFor("assessment-queued"), "Enter");
    press(rowFor("assessment-waiting"), " ");
    expect(toggled).toEqual(["assessment-queued", "assessment-waiting"]);
  });

  it("uses button semantics: role, tabindex, aria-expanded, a distinct label", () => {
    renderGated();
    const row = rowFor("assessment-queued");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.getAttribute("aria-label")).toBe("View setup and testing status for Example Application A");
  });

  it("flips aria-expanded and shows the expanded content when open", () => {
    renderGated("assessment-queued");
    const row = rowFor("assessment-queued");
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Setup progress for Example Application A");
  });

  it("shows the down chevron, not the navigation chevron", () => {
    renderGated();
    const cells = rowFor("assessment-queued").querySelectorAll("td");
    const trailing = cells[cells.length - 1];
    expect(trailing.querySelector("svg.lucide-chevron-down")).not.toBeNull();
    expect(trailing.querySelector("svg.lucide-chevron-right")).toBeNull();
  });

  it("rotates the chevron when expanded", () => {
    renderGated("assessment-queued");
    const cells = rowFor("assessment-queued").querySelectorAll("td");
    expect(cells[cells.length - 1].querySelector("svg")?.getAttribute("class")).toContain("rotate-180");
  });

  it("gets the same pointer and hover affordance as a navigable row", () => {
    renderGated();
    expect(rowFor("assessment-queued").getAttribute("class")).toContain("cursor-pointer");
  });

  it("does not toggle when a nested action inside the expanded content is clicked", () => {
    renderGated("assessment-queued");
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
    click(button);
    expect(deleted).toEqual(["assessment-queued"]);
    expect(toggled).toEqual([]);
  });
});

describe("rowActivation: navigate (a completed assessment row)", () => {
  it("opens on a click anywhere on the row", () => {
    renderGated();
    click(rowFor("assessment-done"));
    expect(opened).toEqual(["assessment-done"]);
  });

  it("opens with Enter and Space", () => {
    renderGated();
    press(rowFor("assessment-done"), "Enter");
    press(rowFor("assessment-done"), " ");
    expect(opened).toEqual(["assessment-done", "assessment-done"]);
  });

  it("uses link semantics with the rowLabel", () => {
    renderGated();
    const row = rowFor("assessment-done");
    expect(row.getAttribute("role")).toBe("link");
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-label")).toBe("Open the assessment for Example Application C");
    expect(row.getAttribute("aria-expanded")).toBeNull();
  });

  it("shows the navigation chevron and no dropdown", () => {
    renderGated();
    const cells = rowFor("assessment-done").querySelectorAll("td");
    const trailing = cells[cells.length - 1];
    expect(trailing.querySelector("svg.lucide-chevron-right")).not.toBeNull();
    expect(trailing.querySelector("svg.lucide-chevron-down")).toBeNull();
  });

  it("ignores other keys", () => {
    renderGated();
    press(rowFor("assessment-done"), "a");
    expect(opened).toEqual([]);
  });
});

describe("rowActivation: none, and the default with no rowActivation prop", () => {
  it("is fully inert when a row resolves to none", () => {
    act(() =>
      root.render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          onRowClick={() => opened.push("x")}
          rowActivation={() => "none"}
        />,
      ),
    );
    click(rowFor("assessment-queued"));
    expect(opened).toEqual([]);
    expect(rowFor("assessment-queued").getAttribute("tabindex")).toBeNull();
    expect(rowFor("assessment-queued").getAttribute("role")).toBeNull();
  });

  it("renders a plain read-only table when no row action is given at all", () => {
    act(() => root.render(<DataTable columns={COLUMNS} rows={ROWS} />));
    expect(container.querySelectorAll("thead th")).toHaveLength(COLUMNS.length);
    expect(rowFor("assessment-queued").getAttribute("role")).toBeNull();
  });

  it("defaults every row to navigate when only onRowClick is given, unchanged for existing callers", () => {
    act(() =>
      root.render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          onRowClick={(row) => opened.push(row.id)}
          rowLabel={(row) => `Open ${row.name}`}
        />,
      ),
    );
    click(rowFor("assessment-queued"));
    expect(opened).toEqual(["assessment-queued"]);
    expect(rowFor("assessment-queued").getAttribute("role")).toBe("link");
  });
});

describe("the same activation model on the mobile card list", () => {
  function renderGatedCards(expandedRowId: string | null = null) {
    act(() =>
      root.render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          onRowClick={(row) => opened.push(row.id)}
          rowLabel={(row) => `Open the assessment for ${row.name}`}
          rowActivation={activationByStatus}
          expandLabel={(row) => `View setup and testing status for ${row.name}`}
          expandedRowId={expandedRowId}
          onToggleExpand={(row) => toggled.push(row.id)}
          renderExpanded={(row) => <p>Setup progress for {row.name}</p>}
          renderCard={(row) => <span>{row.name}</span>}
        />,
      ),
    );
  }

  function mobileCards() {
    return [...container.querySelectorAll("ul.md\\:hidden > li")];
  }

  it("opens a completed card on click", () => {
    renderGatedCards();
    click(mobileCards()[2].querySelector("button")!);
    expect(opened).toEqual(["assessment-done"]);
  });

  it("expands an incomplete card instead of navigating", () => {
    renderGatedCards();
    click(mobileCards()[0].querySelector("button")!);
    expect(toggled).toEqual(["assessment-queued"]);
    expect(opened).toEqual([]);
  });

  it("shows the expanded content inline once toggled open", () => {
    renderGatedCards("assessment-queued");
    expect(mobileCards()[0].textContent).toContain("Setup progress for Example Application A");
  });

  it("matches the desktop aria-expanded and label on the card's own button", () => {
    renderGatedCards();
    const button = mobileCards()[0].querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("View setup and testing status for Example Application A");
  });
});
