// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleCan, type Capability } from "@/auth/permissions";
import type { ControlDetail as ControlDefinition } from "@/api/playbook-types";
import type { TicketControl, TicketControlStep, UserRole } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TICKET = "example-ticket-id";
const APPLICATION = "example-app-id";
const RISK = "example-feature-01-risk-01";

let ticketRow: Record<string, unknown> = {};

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET,
    application_id: APPLICATION,
    finding: { platform: "ios", test_id: RISK },
    application: { platform: "ios" },
    ...overrides,
  };
}
const CONTROL = "example-feature-01-risk-01-control-01";

let roles: UserRole[] = ["developer"];
let definition: ControlDefinition | undefined;
let stepRows: TicketControlStep[] = [];
let source: unknown = undefined;
let playbookUpdated = false;
const saved: { stepId: string; status: string; note?: string }[] = [];

function step(key: string, number: number, title: string, withImage = false) {
  return {
    step_key: key,
    step_id_source: "declared",
    content_hash: `sha256:${key}`,
    step_index: number - 1,
    number,
    step_title: title,
    text: `Body of ${title}.`,
    content: withImage
      ? [
          {
            type: "image",
            path: "screenshots/a.png",
            alt: "Example",
            caption: "First capture",
            url: "/platforms/ios/controls/example/assets/a.png",
            exists: true,
          },
          {
            type: "image",
            path: "screenshots/b.png",
            alt: "Example",
            caption: "Second capture",
            url: "/platforms/ios/controls/example/assets/b.png",
            exists: true,
          },
          { type: "code", text: "example --flag", language: "bash" },
        ]
      : [],
  };
}

function control(steps: ReturnType<typeof step>[]): ControlDefinition {
  return {
    control_id: CONTROL,
    risk_id: "example-feature-01-risk-01",
    platform: "ios",
    title: "Example Control",
    status: "active",
    required: true,
    step_count: steps.length,
    playbook_revision: "sha256:aaa",
    has_source_archive: false,
    summary: "Example control summary.",
    source_file: `${CONTROL}.md`,
    status_source: "default",
    intro: [],
    steps,
    references: [],
    source_archives: [],
    source_download_url: null,
  } as unknown as ControlDefinition;
}

function progressRow(stepKey: string, status = "not_started"): TicketControlStep {
  return {
    id: `row-${stepKey}`,
    ticket_control_id: "tc-1",
    step_key: stepKey,
    status,
    completed_at: null,
    completed_by: null,
    developer_note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as TicketControlStep;
}

const controlRow = {
  id: "tc-1",
  ticket_id: TICKET,
  control_id: CONTROL,
  status: "not_started",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
} as TicketControl;

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "example-developer-id", display_name: "Example Developer", roles },
    can: (capability: Capability) => roleCan(roles, capability),
  }),
}));

vi.mock("@/hooks/queries", () => {
  const idle = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  return {
    useTicket: () => ({
      ...idle,
      data: ticketRow,
    }),
    useControlDetail: () => ({ ...idle, data: definition }),
    useControlSource: () => ({ ...idle, data: source }),
    useTicketControls: () => ({ ...idle, data: [controlRow] }),
    useTicketControlSteps: () => ({ ...idle, data: stepRows }),
    usePlaybookRevisionWatch: () => ({ updated: playbookUpdated, dismiss: () => {} }),
    useSetControlStepStatus: () => ({
      mutate: (input: { stepId: string; status: string; note?: string }) => saved.push(input),
      isPending: false,
      isError: false,
      error: null,
    }),
  };
});

const ControlDetail = (await import("@/pages/ControlDetail")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  roles = ["developer"];
  ticketRow = ticket();
  definition = control([
    step("rotate-example-key", 1, "Understand the fix", true),
    step("revoke-example-key", 2, "Implement protection"),
    step("verify-example-key", 3, "Verify the fix"),
  ]);
  stepRows = [
    progressRow("rotate-example-key"),
    progressRow("revoke-example-key"),
    progressRow("verify-example-key"),
  ];
  saved.length = 0;
  source = undefined;
  playbookUpdated = false;
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
      <MemoryRouter initialEntries={[`/resolve/tickets/${TICKET}/controls/${CONTROL}`]}>
        <Routes>
          <Route
            path="/resolve/tickets/:ticketId/controls/:controlId"
            element={<ControlDetail />}
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

function navButtons() {
  const nav = container.querySelector("nav[aria-label='Remediation steps']");
  return [...(nav?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
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

describe("the guided remediation steps", () => {
  it("shows one step at a time, not the whole document", () => {
    render();
    expect(text()).toContain("Body of Understand the fix.");
    expect(text()).not.toContain("Body of Implement protection.");
    expect(text()).not.toContain("Body of Verify the fix.");
  });

  it("builds its navigation from the backend's own steps", () => {
    render();
    expect(navButtons().map((b) => b.textContent)).toEqual([
      "1Understand the fix",
      "2Implement protection",
      "3Verify the fix",
    ]);
  });

  it("takes however many steps the playbook currently lists", () => {
    definition = control([step("only-example-key", 1, "The only step")]);
    stepRows = [progressRow("only-example-key")];
    render();

    expect(navButtons()).toHaveLength(1);
    expect(buttonLabelled("Next Step")).toBeUndefined();
  });

  it("changes the active step from the navigation", () => {
    render();
    click(navButtons()[2]);
    expect(text()).toContain("Body of Verify the fix.");
    expect(navButtons()[2].getAttribute("aria-current")).toBe("step");
  });

  it("moves with Previous and Next", () => {
    render();
    click(buttonLabelled("Next Step"));
    expect(text()).toContain("Body of Implement protection.");

    click(buttonLabelled("Previous"));
    expect(text()).toContain("Body of Understand the fix.");
  });

  it("offers no way back from the first step", () => {
    render();
    expect(buttonLabelled("Previous")).toBeUndefined();

    click(navButtons()[1]);
    expect(buttonLabelled("Previous")).toBeDefined();
  });

  it("finishes rather than offering Next on the last step", () => {
    render();
    click(navButtons()[2]);
    expect(buttonLabelled("Next Step")).toBeUndefined();
    expect(text()).toContain("Done");
  });

  it("records completion against the stable backend step id", () => {
    render();
    click(buttonLabelled("Mark complete"));
    expect(saved).toEqual([{ stepId: "row-rotate-example-key", status: "completed" }]);
  });

  it("lets a completed step be undone", () => {
    stepRows = [
      progressRow("rotate-example-key", "completed"),
      progressRow("revoke-example-key"),
      progressRow("verify-example-key"),
    ];
    render();

    expect(buttonLabelled("Completed")).toBeDefined();
    click(buttonLabelled("Completed"));
    expect(saved).toEqual([{ stepId: "row-rotate-example-key", status: "not_started" }]);
  });

  it("marks completed steps in the navigation with a check, not colour alone", () => {
    stepRows = [
      progressRow("rotate-example-key", "completed"),
      progressRow("revoke-example-key"),
      progressRow("verify-example-key"),
    ];
    render();

    const markers = navButtons().map((b) => b.querySelector("[data-guided-marker]")!);
    expect(markers[0].querySelector("svg.lucide-check")).not.toBeNull();
    expect(markers[1].textContent).toBe("2");
  });

  it("still supports a note against the active step", () => {
    render();
    click(buttonLabelled("Add a note"));
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("keeps a reader who cannot record progress read-only", () => {
    roles = ["security"];
    render();

    expect(buttonLabelled("Mark complete")?.disabled).toBe(true);
    expect(text()).not.toContain("Add a note");
  });

  it("keeps step screenshots compact and side by side", () => {
    render();
    const figures = [...container.querySelectorAll("figure")];
    expect(figures).toHaveLength(2);
    expect(figures[0].parentElement?.className).toContain("flex-wrap");
    for (const figure of figures) {
      const image = figure.querySelector("img") as HTMLImageElement;
      expect(image.className).toContain("max-w-[min(100%,13rem)]");
      expect(image.className).toContain("object-contain");
      expect(image.className).not.toContain("w-full");
    }
  });

  it("leaves code blocks scrolling inside their own box", () => {
    render();
    expect(container.querySelector("pre")?.className).toContain("overflow-x-auto");
  });

  it("returns to the risk page that holds the conversation, not to a ticket page", () => {
    render();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(`/resolve/applications/${APPLICATION}/risks/${RISK}`);
    expect(hrefs).not.toContain(`/resolve/tickets/${TICKET}`);
  });

  it("sends Close, Cancel and Done to that same page", () => {
    render();
    const target = `/resolve/applications/${APPLICATION}/risks/${RISK}`;
    const linkNamed = (name: string) =>
      [...container.querySelectorAll("a")].find((a) => a.textContent?.trim() === name);

    const close = container.querySelector("a[aria-label^='Back to']");
    expect(close?.getAttribute("href")).toBe(target);
    expect(linkNamed("Cancel")?.getAttribute("href")).toBe(target);

    // Done only replaces Next Step on the final step.
    act(() => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Next Step"))
        ?.click();
    });
    act(() => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Next Step"))
        ?.click();
    });
    expect(linkNamed("Done")?.getAttribute("href")).toBe(target);
  });

  it("url-encodes a risk id that needs it", () => {
    ticketRow = ticket({ finding: { platform: "ios", test_id: "example risk/01" } });
    render();
    const close = container.querySelector("a[aria-label^='Back to']");
    expect(close?.getAttribute("href")).toBe(
      `/resolve/applications/${APPLICATION}/risks/example%20risk%2F01`,
    );
  });

  it("falls back to the application when a legacy ticket names no risk", () => {
    ticketRow = ticket({ finding: null });
    render();
    const close = container.querySelector("a[aria-label^='Back to']");
    expect(close?.getAttribute("href")).toBe(`/resolve/applications/${APPLICATION}`);
  });

  it("falls back to Resolve when a legacy ticket names neither", () => {
    ticketRow = ticket({ finding: null, application_id: null });
    render();
    const close = container.querySelector("a[aria-label^='Back to']");
    expect(close?.getAttribute("href")).toBe("/resolve");
  });

  it("says so plainly when the playbook lists no steps", () => {
    definition = control([]);
    stepRows = [];
    render();

    expect(text()).toContain("no remediation steps yet");
    expect(container.querySelector("nav[aria-label='Remediation steps']")).toBeNull();
  });
});

describe("remediation metadata inside the guided card", () => {
  const archive = {
    control_id: CONTROL,
    exists: true,
    download_enabled: true,
    file_name: "example-implementation.zip",
    size_bytes: 2048,
    sha256: "a".repeat(64),
    declared: [],
  };

  function card() {
    return container.querySelector("nav[aria-label='Remediation steps']")?.closest(".rounded-xl");
  }

  function disclosure(title: string) {
    return [...container.querySelectorAll("details")].find((entry) =>
      (entry.querySelector("summary")?.textContent ?? "").includes(title),
    );
  }

  it("folds the introduction into the card instead of a disconnected panel below it", () => {
    definition = {
      ...control([step("rotate-example-key", 1, "Understand the fix")]),
      intro: [{ type: "paragraph", text: "Read this before you start." }],
    } as ControlDefinition;
    stepRows = [progressRow("rotate-example-key")];
    render();

    const about = disclosure("About this control");
    expect(about).toBeDefined();
    expect(card()?.contains(about!)).toBe(true);
    expect(text()).toContain("Read this before you start.");
  });

  it("shows the introduction once, not repeated on every step", () => {
    definition = {
      ...control([
        step("rotate-example-key", 1, "Understand the fix"),
        step("revoke-example-key", 2, "Implement protection"),
      ]),
      intro: [{ type: "paragraph", text: "Read this before you start." }],
    } as ControlDefinition;
    stepRows = [progressRow("rotate-example-key"), progressRow("revoke-example-key")];
    render();
    click(navButtons()[1]);

    expect([...container.querySelectorAll("details")].filter((entry) =>
      (entry.querySelector("summary")?.textContent ?? "").includes("About this control"),
    )).toHaveLength(1);
  });

  it("keeps references reachable inside the guided experience", () => {
    definition = {
      ...control([step("rotate-example-key", 1, "Understand the fix")]),
      references: [{ label: "Example reference", url: "https://example.test/reference" }],
    } as ControlDefinition;
    stepRows = [progressRow("rotate-example-key")];
    render();

    const references = disclosure("References");
    expect(card()?.contains(references!)).toBe(true);
    const link = references?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/reference");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("keeps the implementation example downloadable inside the guided experience", () => {
    source = archive;
    render();

    const example = disclosure("Implementation example");
    expect(card()?.contains(example!)).toBe(true);
    expect(example?.querySelector("a")?.getAttribute("href")).toContain("/source/download");
  });

  it("leaves no metadata card stacked underneath the guided card", () => {
    definition = {
      ...control([step("rotate-example-key", 1, "Understand the fix")]),
      intro: [{ type: "paragraph", text: "Read this before you start." }],
      references: [{ label: "Example reference", url: "https://example.test/reference" }],
    } as ControlDefinition;
    stepRows = [progressRow("rotate-example-key")];
    source = archive;
    render();

    for (const entry of container.querySelectorAll("details")) {
      expect(card()?.contains(entry)).toBe(true);
    }
  });

  it("shows a playbook update inside the card rather than as a competing banner above it", () => {
    playbookUpdated = true;
    render();

    const notice = [...container.querySelectorAll("p")].find((p) =>
      (p.textContent ?? "").includes("Remediation instructions were updated"),
    );
    expect(notice).toBeDefined();
    expect(card()?.contains(notice!)).toBe(true);
  });

  it("keeps the read-only notice and the control's status together in the tip", () => {
    roles = ["security"];
    definition = {
      ...control([step("rotate-example-key", 1, "Understand the fix")]),
      status: "deprecated",
    } as ControlDefinition;
    stepRows = [progressRow("rotate-example-key")];
    render();

    expect(text()).toContain("marked deprecated");
    expect(text()).toContain("Only the developers assigned to this application can record progress");
  });
});
