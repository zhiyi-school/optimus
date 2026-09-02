// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControlChecklist } from "@/components/control-checklist";
import { ControlDefinitionList } from "@/components/control-definition-list";
import { liveControls } from "@/lib/resolve";
import type { ControlDetail } from "@/api/playbook-types";
import type { TicketControl, TicketControlStep } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONTROL_ID = "example-feature-01-risk-01-control-01";
const SECOND_CONTROL_ID = "example-feature-01-risk-01-control-02";
const TICKET_ROUTE = `/resolve/tickets/example-ticket-id/controls/${CONTROL_ID}`;
const READ_ONLY_ROUTE = `/tickets/example-ticket-id/controls/${CONTROL_ID}`;
const PREVIEW_ROUTE = `/findings/example-finding-id/controls/${CONTROL_ID}`;

function definition(overrides: Partial<ControlDetail> = {}): ControlDetail {
  return {
    control_id: CONTROL_ID,
    risk_id: "example-feature-01-risk-01",
    platform: "ios",
    title: "Control 1",
    status: "active",
    required: true,
    step_count: 2,
    playbook_revision: "sha256:aaa",
    has_source_archive: false,
    summary: "Example control summary.",
    source_file: `${CONTROL_ID}.md`,
    status_source: "default",
    intro: [],
    steps: [
      {
        step_key: "rotate-example-key",
        step_id_source: "declared",
        content_hash: "sha256:one",
        step_index: 0,
        number: 1,
        step_title: "First",
        text: "",
        content: [],
      },
      {
        step_key: "revoke-example-key",
        step_id_source: "declared",
        content_hash: "sha256:two",
        step_index: 1,
        number: 2,
        step_title: "Second",
        text: "",
        content: [],
      },
    ],
    references: [],
    source_archives: [],
    source_download_url: null,
    ...overrides,
  };
}

function progressRow(overrides: Partial<TicketControl> = {}): TicketControl {
  return {
    id: "tc-1",
    ticket_id: "example-ticket-id",
    control_id: CONTROL_ID,
    status: "not_started",
    required: true,
    completed_at: null,
    completed_by: null,
    developer_note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function stepRow(stepKey: string, controlRowId = "tc-1"): TicketControlStep {
  return {
    id: `${controlRowId}-${stepKey}`,
    ticket_control_id: controlRowId,
    step_key: stepKey,
    status: "not_started",
    completed_at: null,
    completed_by: null,
    developer_note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

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

function render(node: ReactNode) {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/start"]}>
        {node}
        <LocationProbe />
      </MemoryRouter>,
    ),
  );
}

function path() {
  return container.querySelector("[data-location]")?.getAttribute("data-location");
}

function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

function anchors() {
  return [...container.querySelectorAll("a")];
}

function card() {
  const anchor = anchors()[0];
  if (!anchor) throw new Error("the control card is not a link");
  return anchor;
}

function withText(text: string) {
  return [...card().querySelectorAll("*")].find((el) => el.textContent?.trim() === text);
}

function checklist(
  props: Partial<Parameters<typeof ControlChecklist>[0]> & {
    definitions?: ControlDetail[];
    rows?: TicketControl[];
    stepRows?: TicketControlStep[];
  } = {},
) {
  const { definitions = [definition()], rows = [progressRow()], stepRows, ...rest } = props;
  const steps = stepRows ?? [stepRow("rotate-example-key"), stepRow("revoke-example-key")];
  return (
    <ControlChecklist
      controls={rest.controls ?? liveControls(definitions, rows, steps)}
      linkTo={(id) => `/resolve/tickets/example-ticket-id/controls/${id}`}
      {...rest}
    />
  );
}

function previewList(props: Partial<Parameters<typeof ControlDefinitionList>[0]> = {}) {
  return (
    <ControlDefinitionList
      controls={[definition()]}
      linkTo={(id) => `/findings/example-finding-id/controls/${id}`}
      {...props}
    />
  );
}

describe("ControlChecklist card navigation", () => {
  it("opens the control from the title", () => {
    render(checklist());
    click(withText("Control 1"));
    expect(path()).toBe(TICKET_ROUTE);
  });

  it("opens the control from the summary", () => {
    render(checklist());
    click(withText("Example control summary."));
    expect(path()).toBe(TICKET_ROUTE);
  });

  it("opens the control from the status badge", () => {
    render(checklist());
    click(withText("Not started"));
    expect(path()).toBe(TICKET_ROUTE);
  });

  it("opens the control from the progress bar, which is not itself a control", () => {
    render(checklist());
    click(card().querySelector("[role='progressbar']"));
    expect(path()).toBe(TICKET_ROUTE);
  });

  it("opens the control from the card's own padding", () => {
    render(checklist());
    click(card().firstElementChild);
    expect(path()).toBe(TICKET_ROUTE);
  });

  it("still opens the control from the View steps text", () => {
    render(checklist());
    click(withText("View steps"));
    expect(path()).toBe(TICKET_ROUTE);
  });

  it("navigates when the focused card is activated from the keyboard", () => {
    render(checklist());
    const anchor = card();
    act(() => anchor.focus());

    expect(document.activeElement).toBe(anchor);
    click(anchor);
    expect(path()).toBe(TICKET_ROUTE);
  });

  it("carries a visible focus style", () => {
    render(checklist());
    expect(card().className).toContain("focus-visible:ring");
  });

  it("names its destination for a screen reader", () => {
    render(checklist());
    expect(card().getAttribute("aria-label")).toBe("View steps for Control 1");
  });

  it("sends a ticket viewer without Resolve access to the ticket-scoped route", () => {
    render(checklist({ linkTo: (id) => `/tickets/example-ticket-id/controls/${id}` }));
    click(withText("Control 1"));
    expect(path()).toBe(READ_ONLY_ROUTE);
  });

  it("is one link per control, with nothing interactive inside it", () => {
    render(
      checklist({
        definitions: [definition(), definition({ control_id: SECOND_CONTROL_ID, title: "Control 2" })],
        rows: [progressRow(), progressRow({ id: "tc-2", control_id: SECOND_CONTROL_ID })],
      }),
    );

    expect(anchors()).toHaveLength(2);
    for (const anchor of anchors()) {
      expect(anchor.getAttribute("href")).toBeTruthy();
      expect(anchor.querySelector("a, button, input, select, textarea")).toBeNull();
    }
  });

  it("takes the control title and summary from the playbook, never from a stored row", () => {
    render(
      checklist({
        definitions: [
          definition({ title: "Renamed in the playbook", summary: "Rewritten summary." }),
        ],
      }),
    );

    expect(container.textContent).toContain("Renamed in the playbook");
    expect(container.textContent).toContain("Rewritten summary.");
    expect(container.textContent).not.toContain("Control 1");
    expect(container.textContent).not.toContain("Example control summary.");
  });

  it("says so when the backend could not supply the control definitions", () => {
    render(checklist({ controls: [], unavailable: true }));

    expect(container.textContent).toContain("Remediation instructions are unavailable");
    expect(container.textContent).toContain("Your recorded progress is safe");
    expect(anchors()).toHaveLength(0);
  });

  it("shows a control the playbook lists even before the ticket has a row for it", () => {
    render(checklist({ rows: [], stepRows: [] }));

    expect(container.textContent).toContain("Control 1");
    expect(container.textContent).toContain("Not started");
  });

  it("hides a control the playbook no longer lists, however much progress it holds", () => {
    render(
      checklist({
        rows: [progressRow(), progressRow({ id: "tc-9", control_id: "example-removed-control" })],
        stepRows: [
          { ...stepRow("rotate-example-key"), status: "completed" },
          { ...stepRow("revoke-example-key"), status: "completed" },
          { ...stepRow("gone-example-step", "tc-9"), status: "completed" },
        ],
      }),
    );

    expect(anchors()).toHaveLength(1);
    expect(container.textContent).toContain("2 of 2");
  });

  it("keeps the progress bar and its completed count", () => {
    render(
      checklist({
        stepRows: [
          { ...stepRow("rotate-example-key"), status: "completed" },
          stepRow("revoke-example-key"),
        ],
      }),
    );

    expect(card().querySelector("[role='progressbar']")).not.toBeNull();
    expect(container.textContent).toContain("1 of 2");
  });

  it("counts a step the playbook has added but the ticket has no row for", () => {
    render(
      checklist({
        stepRows: [{ ...stepRow("rotate-example-key"), status: "completed" }],
      }),
    );

    expect(container.textContent).toContain("1 of 2");
  });

  it("shows the empty message and no links when the playbook lists no controls", () => {
    render(
      checklist({
        definitions: [],
        rows: [],
        stepRows: [],
        emptyMessage: "The playbook has no developer controls for this risk yet.",
      }),
    );

    expect(container.textContent).toContain("no developer controls for this risk yet");
    expect(anchors()).toHaveLength(0);
  });
});

describe("ControlDefinitionList card navigation", () => {
  it("opens the preview from the title", () => {
    render(previewList());
    click(withText("Control 1"));
    expect(path()).toBe(PREVIEW_ROUTE);
  });

  it("opens the preview from the summary", () => {
    render(previewList());
    click(withText("Example control summary."));
    expect(path()).toBe(PREVIEW_ROUTE);
  });

  it("opens the preview from the required badge", () => {
    render(previewList());
    click(withText("Required"));
    expect(path()).toBe(PREVIEW_ROUTE);
  });

  it("opens the preview from the step count", () => {
    render(previewList());
    click(withText("2 steps"));
    expect(path()).toBe(PREVIEW_ROUTE);
  });

  it("opens the preview from the card's own padding", () => {
    render(previewList());
    click(card().firstElementChild);
    expect(path()).toBe(PREVIEW_ROUTE);
  });

  it("still opens the preview from the View remediation steps text", () => {
    render(previewList());
    click(withText("View remediation steps"));
    expect(path()).toBe(PREVIEW_ROUTE);
  });

  it("navigates when the focused card is activated from the keyboard", () => {
    render(previewList());
    const anchor = card();
    act(() => anchor.focus());

    expect(document.activeElement).toBe(anchor);
    click(anchor);
    expect(path()).toBe(PREVIEW_ROUTE);
  });

  it("carries a visible focus style", () => {
    render(previewList());
    expect(card().className).toContain("focus-visible:ring");
  });

  it("goes to a preview route, never to a ticket", () => {
    render(previewList());
    expect(card().getAttribute("href")).toBe(PREVIEW_ROUTE);
    expect(card().getAttribute("href")).not.toContain("/tickets/");
  });

  it("is one link per control, with nothing interactive inside it", () => {
    render(
      previewList({
        controls: [definition(), definition({ control_id: SECOND_CONTROL_ID, title: "Control 2" })],
      }),
    );

    expect(anchors()).toHaveLength(2);
    for (const anchor of anchors()) {
      expect(anchor.querySelector("a, button, input, select, textarea")).toBeNull();
    }
  });

  it("shows the title, summary and step count of every control", () => {
    render(previewList());
    expect(container.textContent).toContain("Control 1");
    expect(container.textContent).toContain("Example control summary.");
    expect(container.textContent).toContain("2 steps");
  });

  it("says one step in the singular", () => {
    render(previewList({ controls: [definition({ step_count: 1 })] }));
    expect(container.textContent).toContain("1 step");
    expect(container.textContent).not.toContain("1 steps");
  });

  it("marks an active control required and a deprioritised one optional", () => {
    render(
      previewList({
        controls: [
          definition(),
          definition({
            control_id: SECOND_CONTROL_ID,
            title: "Control 2",
            status: "deprioritized",
            required: false,
          }),
        ],
      }),
    );

    expect(container.textContent).toContain("Required");
    expect(container.textContent).toContain("Optional");
    expect(container.textContent).toContain("Deprioritised");
    expect(container.textContent).toContain("Not counted as required remediation work.");
  });

  it("treats a deprecated control the catalogue still marks required as optional", () => {
    render(previewList({ controls: [definition({ status: "deprecated", required: true })] }));
    expect(container.textContent).toContain("Optional");
    expect(container.textContent).not.toContain("Required");
  });

  it("offers nothing that could record progress", () => {
    render(previewList());
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("explains itself when the risk has no controls", () => {
    render(previewList({ controls: [] }));
    expect(container.textContent).toContain("no developer controls for this risk yet");
    expect(anchors()).toHaveLength(0);
  });

  it("explains itself when the backend returned nothing at all", () => {
    render(previewList({ controls: undefined }));
    expect(container.textContent).toContain("no developer controls for this risk yet");
  });
});
