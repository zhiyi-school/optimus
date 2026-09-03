// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableColumn } from "@/components/data-display";

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

let container: HTMLDivElement;
let root: Root;
let opened: string[];
let toggled: string[];

beforeEach(() => {
  opened = [];
  toggled = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Every unfinished assessment is expandable, which is where navigation used to be lost. */
function render(expandedRowId: string | null = null) {
  act(() =>
    root.render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        onRowClick={(row) => opened.push(row.id)}
        rowLabel={(row) => `Open the assessment for ${row.name}`}
        expandedRowId={expandedRowId}
        onToggleExpand={(row) => toggled.push(row.id)}
        renderExpanded={(row) =>
          row.status === "completed" ? null : <p>Setup progress for {row.name}</p>
        }
      />,
    ),
  );
}

function rows() {
  return [...container.querySelectorAll("tbody tr")];
}

function rowFor(id: string) {
  const index = ROWS.findIndex((row) => row.id === id);
  return rows()[index];
}

function expandButtons() {
  return [...container.querySelectorAll("button[aria-expanded]")];
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("opening a row", () => {
  it("opens a queued assessment, which is also expandable", () => {
    render();
    click(rowFor("assessment-queued"));

    expect(opened).toEqual(["assessment-queued"]);
    expect(toggled).toEqual([]);
  });

  it("opens an assessment that is waiting for a device", () => {
    render();
    click(rowFor("assessment-waiting"));

    expect(opened).toEqual(["assessment-waiting"]);
  });

  it("opens a row that has nothing to expand", () => {
    render();
    click(rowFor("assessment-done"));

    expect(opened).toEqual(["assessment-done"]);
  });

  it("still opens the row while it is expanded", () => {
    render("assessment-queued");
    click(rowFor("assessment-queued"));

    expect(opened).toEqual(["assessment-queued"]);
  });
});

describe("the expand control", () => {
  it("is a control of its own, not the whole row", () => {
    render();

    expect(expandButtons()).toHaveLength(2);
    expect(expandButtons()[0].getAttribute("aria-label")).toBe("Show details");
  });

  it("expands without navigating", () => {
    render();
    click(expandButtons()[0]);

    expect(toggled).toEqual(["assessment-queued"]);
    expect(opened).toEqual([]);
  });

  it("says whether it is open", () => {
    render("assessment-queued");

    expect(expandButtons()[0].getAttribute("aria-expanded")).toBe("true");
    expect(expandButtons()[0].getAttribute("aria-label")).toBe("Hide details");
    expect(container.textContent).toContain("Setup progress for Example Application A");
  });

  it("offers no expand control for a row with nothing to show", () => {
    render();
    const cells = rowFor("assessment-done").querySelectorAll("td");
    expect(cells[cells.length - 1].querySelector("button")).toBeNull();
  });
});

describe("keyboard access", () => {
  function press(element: Element, key: string) {
    act(() =>
      element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
    );
  }

  it("puts every openable row in the tab order and names it", () => {
    render();

    expect(rowFor("assessment-queued").getAttribute("tabindex")).toBe("0");
    expect(rowFor("assessment-queued").getAttribute("aria-label")).toBe(
      "Open the assessment for Example Application A",
    );
  });

  it("opens a row with Enter and with Space", () => {
    render();
    press(rowFor("assessment-queued"), "Enter");
    press(rowFor("assessment-waiting"), " ");

    expect(opened).toEqual(["assessment-queued", "assessment-waiting"]);
  });

  it("ignores other keys", () => {
    render();
    press(rowFor("assessment-queued"), "a");

    expect(opened).toEqual([]);
  });

  it("leaves rows out of the tab order when nothing opens them", () => {
    const onToggle = vi.fn();
    act(() =>
      root.render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          expandedRowId={null}
          onToggleExpand={onToggle}
          renderExpanded={() => <p>Details</p>}
        />,
      ),
    );

    expect(rows()[0].getAttribute("tabindex")).toBeNull();
  });
});
