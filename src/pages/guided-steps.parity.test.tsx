// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleCan, type Capability } from "@/auth/permissions";
import type { ControlDetail as ControlDefinition } from "@/api/playbook-types";
import type { TicketControl, TicketControlStep, UserRole } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASSESSMENT = "example-assessment-id";
const RISK = "example-feature-01-risk-01";
const FINDING = "example-finding-id";
const TICKET = "example-ticket-id";
const APPLICATION = "example-app-id";
const CONTROL = "example-feature-01-risk-01-control-01";

let roles: UserRole[] = ["developer"];
let definition: ControlDefinition | undefined;
let stepRows: TicketControlStep[] = [];
let manualSteps: { id: string; text: string }[] = [];
let controlLoading = false;
let controlErrored = false;
let savePending = false;
let saveError: Error | null = null;
const saved: { stepId: string; status: string; note?: string }[] = [];

function controlStep(key: string, number: number, title: string) {
  return {
    step_key: key,
    step_id_source: "declared",
    content_hash: `sha256:${key}`,
    step_index: number - 1,
    number,
    step_title: title,
    text: `Body of ${title}.`,
    content: [
      {
        type: "image",
        path: "screenshots/example.png",
        alt: "Example",
        caption: "Example capture",
        url: "/platforms/ios/controls/example/assets/example.png",
        exists: true,
      },
      { type: "code", text: "example --flag", language: "bash" },
    ],
  };
}

function control(steps: ReturnType<typeof controlStep>[]): ControlDefinition {
  return {
    control_id: CONTROL,
    risk_id: RISK,
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
    intro: [{ type: "paragraph", text: "Read this before you start." }],
    steps,
    references: [{ label: "Example reference", url: "https://example.test/reference" }],
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
  const mutation = {
    mutateAsync: () => Promise.resolve({ id: TICKET }),
    mutate: () => {},
    isPending: false,
    isError: false,
    error: undefined,
  };
  return {
    useAssessment: () => ({ ...idle, data: { application: { platform: "ios" } } }),
    useRiskCatalogue: () => ({
      ...idle,
      data: [
        {
          risk_id: RISK,
          name: "Example Risk",
          goal: "Show that the risk is present.",
          demonstration: [
            {
              type: "steps",
              id: "example-block",
              items: manualSteps.map((step) => ({
                id: step.id,
                text: step.text,
                commands: ["example --flag"],
                images: [
                  {
                    path: "screenshots/example.png",
                    caption: "Example capture",
                    url: "/reports/example/example.png",
                    exists: true,
                  },
                ],
              })),
            },
          ],
        },
      ],
    }),
    useFinding: () => ({
      ...idle,
      data: {
        id: FINDING,
        platform: "ios",
        application_id: "example-app-id",
        test_id: RISK,
        assessment_id: ASSESSMENT,
        title: "Example finding",
        application: { id: "example-app-id", name: "Example Application", platform: "ios" },
      },
    }),
    useTicket: () => ({
      ...idle,
      data: {
        id: TICKET,
        application_id: APPLICATION,
        finding: { platform: "ios", test_id: RISK },
        application: { platform: "ios" },
      },
    }),
    useControlDetail: () => ({
      ...idle,
      data: controlErrored ? undefined : definition,
      isLoading: controlLoading,
      isError: controlErrored,
    }),
    useControlSource: () => idle,
    useTicketControls: () => ({ ...idle, data: [controlRow] }),
    useTicketControlSteps: () => ({ ...idle, data: stepRows }),
    usePlaybookRevisionWatch: () => ({ updated: false, dismiss: () => {} }),
    useSetControlStepStatus: () => ({
      mutate: (input: { stepId: string; status: string; note?: string }) => saved.push(input),
      isPending: savePending,
      isError: saveError !== null,
      error: saveError,
    }),
    useFindingTickets: () => ({ ...idle, data: [] }),
    useRiskControls: () => idle,
    useStartRemediation: () => mutation,
    useResumeTicket: () => mutation,
  };
});

const ManualTestSteps = (await import("@/pages/ManualTestSteps")).default;
const ControlPreview = (await import("@/pages/ControlPreview")).default;
const ControlDetail = (await import("@/pages/ControlDetail")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  roles = ["developer"];
  controlLoading = false;
  controlErrored = false;
  savePending = false;
  saveError = null;
  manualSteps = [
    { id: "one", text: "Install the reference build." },
    { id: "two", text: "Capture the traffic." },
    { id: "three", text: "Confirm the exposure." },
  ];
  definition = control([
    controlStep("rotate-example-key", 1, "Understand the fix"),
    controlStep("revoke-example-key", 2, "Implement protection"),
    controlStep("verify-example-key", 3, "Verify the fix"),
  ]);
  stepRows = [
    progressRow("rotate-example-key"),
    progressRow("revoke-example-key"),
    progressRow("verify-example-key"),
  ];
  saved.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

type PageName = "manual" | "preview" | "detail";

const routes: Record<PageName, { path: string; entry: string; element: JSX.Element }> = {
  manual: {
    path: "/assessments/:assessmentId/tests/:testId/manual",
    entry: `/assessments/${ASSESSMENT}/tests/${RISK}/manual`,
    element: <ManualTestSteps />,
  },
  preview: {
    path: "/resolve/findings/:findingId/controls/:controlId",
    entry: `/resolve/findings/${FINDING}/controls/${CONTROL}`,
    element: <ControlPreview />,
  },
  detail: {
    path: "/resolve/tickets/:ticketId/controls/:controlId",
    entry: `/resolve/tickets/${TICKET}/controls/${CONTROL}`,
    element: <ControlDetail />,
  },
};

function render(page: PageName) {
  const route = routes[page];
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[route.entry]}>
        <Routes>
          <Route path={route.path} element={route.element} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function remount() {
  act(() => root.unmount());
  container.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
}

function text() {
  return container.textContent ?? "";
}

function card() {
  return container.querySelector("[data-guided-card]") as HTMLElement;
}

function nav() {
  return container.querySelector("nav[aria-label$='steps']") as HTMLElement;
}

function stepButtons() {
  return [...(nav()?.querySelectorAll("li button") ?? [])] as HTMLButtonElement[];
}

function panel() {
  return container.querySelector("[data-guided-panel]") as HTMLElement;
}

function footer() {
  return container.querySelector("[data-guided-footer]") as HTMLElement;
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

/** The structural fingerprint of the guided shell as this page actually renders it. */
function layout() {
  const heading = container.querySelector("h1") as HTMLElement;
  const icon = heading.closest("div")?.parentElement?.querySelector("div") as HTMLElement;
  const first = stepButtons()[0];
  return {
    card: card().className,
    icon: icon.className,
    heading: heading.className,
    navList: (nav().querySelector("ol") as HTMLElement).className,
    stepRow: first.className,
    stepBadge: (first.querySelector("[data-guided-marker]") as HTMLElement).className,
    aside: (container.querySelector("[data-guided-aside]") as HTMLElement).className,
    backdrop: (container.querySelector("[data-guided-backdrop]") as HTMLElement).className,
    body: (container.querySelector("[data-guided-body]") as HTMLElement).className,
    panel: panel().className,
    footer: footer().className,
  };
}

describe("the three guided pages render one shell", () => {
  function layoutFor(page: PageName) {
    remount();
    render(page);
    return layout();
  }

  it("frames manual testing, the preview and the active ticket identically", () => {
    const manual = layoutFor("manual");
    const preview = layoutFor("preview");
    const detail = layoutFor("detail");

    expect(preview).toEqual(manual);
    expect(detail).toEqual(manual);
  });

  it("presents every page as one centred panel over a dark backdrop", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      const backdrop = container.querySelector("[data-guided-backdrop]") as HTMLElement;
      expect(backdrop, page).not.toBeNull();
      expect(backdrop.className, page).toContain("fixed");
      expect(backdrop.className, page).toContain("inset-0");
      expect(backdrop.className, page).toMatch(/bg-\w+\/\d+/);
      expect(backdrop.className, page).toContain("items-center");
      expect(backdrop.className, page).toContain("justify-center");
      expect(backdrop.contains(card()), page).toBe(true);
      expect(card().className, page).toContain("max-w-7xl");
      expect(card().className, page).toContain("h-[94vh]");
      expect(card().className, page).toContain("w-[94vw]");
      expect(container.querySelectorAll("[data-guided-card]"), page).toHaveLength(1);
    }
  });

  it("scrolls only the body, keeping the header and footer in the panel", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      const body = container.querySelector("[data-guided-body]") as HTMLElement;
      expect(body.className, page).toContain("overflow-y-auto");
      expect(body.className, page).toContain("flex-1");
      expect(body.className, page).toContain("min-h-0");
      expect(card().className, page).toContain("overflow-hidden");
      // The regions are siblings, so neither the header nor the footer scrolls away.
      expect(body.contains(footer()), page).toBe(false);
      expect(body.contains(container.querySelector("h1")!), page).toBe(false);
      expect(footer().className, page).toContain("shrink-0");
    }
  });

  it("draws the step list as a connected timeline", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      const rows = stepButtons();
      const connectors = container.querySelectorAll("[data-guided-connector]");
      // One connector between each pair of markers, and none after the last.
      expect(connectors.length, page).toBe(rows.length - 1);
      expect(rows[rows.length - 1].querySelector("[data-guided-connector]"), page).toBeNull();
      for (const connector of connectors) {
        expect(connector.getAttribute("aria-hidden"), page).toBe("true");
      }
      expect(rows[0].querySelector("[data-guided-marker]"), page).not.toBeNull();
    }
  });

  it("highlights the active row and leaves the others neutral", () => {
    render("detail");
    const [first, second] = stepButtons();
    expect(first.className).toContain("bg-primary/10");
    expect(first.className).toContain("text-primary");
    expect(first.querySelector("[data-guided-marker]")!.className).toContain("bg-primary");
    expect(second.className).not.toContain("bg-primary/10");
    expect(second.querySelector("[data-guided-marker]")!.className).toContain("bg-muted");
  });

  it("shows Previous only once there is a step to go back to", () => {
    render("detail");
    expect(buttonLabelled("Previous")).toBeUndefined();

    click(stepButtons()[1]);
    const actions = [...footer().querySelectorAll("a,button")].map((el) => el.textContent?.trim());
    expect(actions).toEqual(["Cancel", "Previous", "Next Step"]);
  });

  it("gives every page the same header parts: icon, title, and one close control", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      expect(container.querySelectorAll("h1"), page).toHaveLength(1);
      const close = container.querySelector("a[aria-label^='Back to']") as HTMLAnchorElement;
      expect(close, page).not.toBeNull();
      expect(close.querySelector("svg.lucide-x"), page).not.toBeNull();
    }
  });

  it("puts no back link above the card, because the close and footer already return", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      const outside = [...container.querySelectorAll("a")].filter((a) => !card().contains(a));
      expect(outside, page).toHaveLength(0);
    }
  });

  it("shows exactly one active step on each page, marked for assistive technology", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      const current = [...container.querySelectorAll("[aria-current='step']")];
      expect(current, page).toHaveLength(1);
      expect(current[0], page).toBe(stepButtons()[0]);
    }
  });

  it("gives every page the same footer actions in the same order", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      const actions = [...footer().querySelectorAll("a,button")].map((el) => el.textContent?.trim());
      expect(actions, page).toEqual(["Cancel", "Next Step"]);
    }
  });

  it("puts each footer action in the tab order once, with its own focus ring", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      // A link wrapping a button would make one action two tab stops.
      expect(footer().querySelector("a button"), page).toBeNull();
      for (const action of footer().querySelectorAll("a,button")) {
        expect(action.className, `${page}: ${action.textContent}`).toContain("focus-visible:ring");
      }
    }
  });

  it("renders images through the shared figure treatment on every page", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      const image = container.querySelector("figure img") as HTMLImageElement;
      expect(image, page).not.toBeNull();
      expect(image.className, page).toContain("max-w-[min(100%,13rem)]");
      expect(image.className, page).toContain("object-contain");
      expect(image.className, page).not.toContain("w-full");
      expect(image.closest("figure")?.className, page).toContain("w-fit");
    }
  });

  it("keeps code blocks scrolling inside their own box on every page", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      const pre = container.querySelector("pre") as HTMLElement;
      expect(pre, page).not.toBeNull();
      expect(pre.className, page).toContain("overflow-x-auto");
      expect(pre.className, page).toContain("rounded-md");
    }
  });

  it("scrolls only the step strip on a narrow screen, never the page", () => {
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      const list = nav().querySelector("ol") as HTMLElement;
      expect(list.className, page).toContain("overflow-x-auto");
      expect(list.className, page).toContain("lg:flex-col");
      // A reserved gutter is what stops the strip's scrollbar sitting on the cards below it.
      expect(list.className, page).toContain("[scrollbar-gutter:stable]");
      expect(panel().className, page).toContain("min-w-0");
    }
  });
});

describe("the guided step list", () => {
  it("takes its length from the backend response, not from a fixed number", () => {
    definition = control([controlStep("only-example-key", 1, "The only step")]);
    stepRows = [progressRow("only-example-key")];
    render("detail");

    expect(stepButtons()).toHaveLength(1);
    expect(buttonLabelled("Next Step")).toBeUndefined();
  });

  it("labels remediation steps with the titles the playbook gives them", () => {
    render("detail");
    expect(stepButtons().map((b) => b.textContent)).toEqual([
      "1Understand the fix",
      "2Implement protection",
      "3Verify the fix",
    ]);
  });

  it("falls back to a numbered label when the backend names no title", () => {
    definition = control([
      { ...controlStep("rotate-example-key", 1, ""), step_title: "" },
      { ...controlStep("revoke-example-key", 2, ""), step_title: "" },
    ]);
    stepRows = [progressRow("rotate-example-key"), progressRow("revoke-example-key")];
    render("detail");

    expect(stepButtons().map((b) => b.textContent)).toEqual(["1Step 1", "2Step 2"]);
  });

  it("moves the active step from the list, from Next and from Previous", () => {
    render("detail");
    click(stepButtons()[2]);
    expect(text()).toContain("Body of Verify the fix.");

    click(buttonLabelled("Previous"));
    expect(text()).toContain("Body of Implement protection.");

    click(buttonLabelled("Next Step"));
    expect(text()).toContain("Body of Verify the fix.");
  });

  it("offers Done instead of Next on the last step, returning where close does", () => {
    render("detail");
    click(stepButtons()[2]);

    const done = [...footer().querySelectorAll("a")].find((a) => a.textContent?.trim() === "Done");
    const close = container.querySelector("a[aria-label^='Back to']") as HTMLAnchorElement;
    expect(done?.getAttribute("href")).toBe(close.getAttribute("href"));
  });

  it("marks a completed remediation step with a check rather than colour alone", () => {
    stepRows = [
      progressRow("rotate-example-key", "completed"),
      progressRow("revoke-example-key"),
      progressRow("verify-example-key"),
    ];
    render("detail");

    const badge = stepButtons()[0].querySelector("[data-guided-marker]") as HTMLElement;
    expect(badge.querySelector("svg.lucide-check")).not.toBeNull();
    expect(stepButtons()[1].querySelector("[data-guided-marker]")?.textContent).toBe("2");
  });

  it("keeps the chosen step selected when progress data comes back changed", () => {
    render("detail");
    click(stepButtons()[1]);
    expect(text()).toContain("Body of Implement protection.");

    stepRows = [
      progressRow("rotate-example-key", "completed"),
      progressRow("revoke-example-key"),
      progressRow("verify-example-key"),
    ];
    render("detail");

    expect(stepButtons()[1].getAttribute("aria-current")).toBe("step");
    expect(text()).toContain("Body of Implement protection.");
  });
});

describe("the active remediation step body", () => {
  function panelOrder() {
    return [...panel().querySelectorAll("p,h2,figure,pre,button")]
      // A figure's own expand control belongs to the image, not to the step's actions.
      .filter((node) => node.tagName === "FIGURE" || !node.closest("figure"))
      .map((node) => {
        if (node.tagName === "H2") return "title";
        if (node.tagName === "FIGURE") return "figure";
        if (node.tagName === "PRE") return "code";
        if (node.tagName === "BUTTON") {
          return node.hasAttribute("aria-pressed") ? "completion" : "note-action";
        }
        return (node.textContent ?? "").startsWith("Step ") ? "number" : "text";
      })
      .filter((name, index, all) => all.indexOf(name) === index);
  }

  it("orders the panel the way manual testing does, with the action after the content", () => {
    render("detail");
    expect(panelOrder()).toEqual(["title", "text", "figure", "code", "completion", "note-action"]);
  });

  it("starts the manual panel with the same heading-then-content shape", () => {
    render("manual");
    expect(panel().querySelector("h2")?.textContent).toBe("Step 1");
    const nodes = [...panel().querySelectorAll("h2,p,figure,pre")];
    expect(nodes[1].textContent).toBe("Install the reference build.");
    expect(panel().querySelector("pre")).not.toBeNull();
    expect(panel().querySelector("figure")).not.toBeNull();
  });

  it("records completion against the stable backend step key", () => {
    render("detail");
    click(buttonLabelled("Mark complete"));
    expect(saved).toEqual([{ stepId: "row-rotate-example-key", status: "completed" }]);
  });

  it("returns a completed step to not started", () => {
    stepRows = [
      progressRow("rotate-example-key", "completed"),
      progressRow("revoke-example-key"),
      progressRow("verify-example-key"),
    ];
    render("detail");

    click(buttonLabelled("Completed"));
    expect(saved).toEqual([{ stepId: "row-rotate-example-key", status: "not_started" }]);
  });

  it("keeps the completion control inside the panel, not in the page header", () => {
    render("detail");
    const toggle = container.querySelector("button[aria-pressed]") as HTMLElement;
    expect(panel().contains(toggle)).toBe(true);
    expect(container.querySelector("h1")?.parentElement?.contains(toggle)).toBe(false);
  });
});

describe("developer notes", () => {
  it("stay collapsed until the developer opens them", () => {
    render("detail");
    expect(container.querySelector("textarea")).toBeNull();

    click(buttonLabelled("Add a note"));
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("sit inside the active step panel, not in a card of their own", () => {
    render("detail");
    click(buttonLabelled("Add a note"));
    expect(panel().contains(container.querySelector("textarea")!)).toBe(true);
  });

  it("open with the note already recorded against the step", () => {
    stepRows = [
      progressRow("rotate-example-key"),
      progressRow("revoke-example-key"),
      progressRow("verify-example-key"),
    ];
    stepRows[0] = { ...stepRows[0], developer_note: "Waiting on the platform team." };
    render("detail");

    expect(text()).toContain("Waiting on the platform team.");
    click(buttonLabelled("Edit note"));
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "Waiting on the platform team.",
    );
  });

  it("save against the step's own progress row", () => {
    render("detail");
    click(buttonLabelled("Add a note"));
    const field = container.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(field, "Blocked on a dependency upgrade.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(buttonLabelled("Save note"));

    expect(saved).toEqual([
      {
        stepId: "row-rotate-example-key",
        status: "not_started",
        note: "Blocked on a dependency upgrade.",
      },
    ]);
  });
});

describe("saving progress", () => {
  it("says a save is under way and blocks a second submission", () => {
    savePending = true;
    render("detail");

    const toggle = container.querySelector("button[aria-pressed]") as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(panel().textContent).toContain("Saving…");
  });

  it("keeps a note from being saved twice while the first save is pending", () => {
    render("detail");
    click(buttonLabelled("Add a note"));
    savePending = true;
    render("detail");

    expect(buttonLabelled("Save note")?.disabled).toBe(true);
  });

  it("shows a failed save inside the step panel without losing the instructions", () => {
    saveError = new Error("Network unreachable");
    render("detail");

    expect(panel().textContent).toContain("Could not save your progress.");
    expect(panel().textContent).toContain("Body of Understand the fix.");
    expect(card().contains(panel())).toBe(true);
  });
});

describe("leaving the workflow", () => {
  it("returns Cancel and the close icon to the same parent page", () => {
    const parents: Record<PageName, string> = {
      manual: `/assessments/${ASSESSMENT}/tests/${RISK}`,
      preview: `/findings/${FINDING}`,
      detail: `/resolve/applications/${APPLICATION}/risks/${RISK}`,
    };
    for (const page of ["manual", "preview", "detail"] as PageName[]) {
      remount();
      render(page);
      const cancel = [...footer().querySelectorAll("a")].find(
        (a) => a.textContent?.trim() === "Cancel",
      );
      const close = container.querySelector("a[aria-label^='Back to']") as HTMLAnchorElement;
      expect(cancel?.getAttribute("href"), page).toBe(parents[page]);
      expect(close.getAttribute("href"), page).toBe(parents[page]);
    }
  });

  it("keeps the step strip scrollable on a narrow screen without moving the footer", () => {
    render("detail");
    const list = nav().querySelector("ol") as HTMLElement;
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("lg:overflow-x-visible");
    expect(panel().className).toContain("min-w-0");
    const bodyRegion = container.querySelector("[data-guided-body]") as HTMLElement;
    expect(bodyRegion.className).toContain("overflow-x-hidden");
    expect(bodyRegion.contains(footer())).toBe(false);
  });
});

describe("read-only and pending states", () => {
  it("offers no editable controls to a reader without the capability", () => {
    roles = ["security"];
    render("detail");

    expect(buttonLabelled("Mark complete")?.disabled).toBe(true);
    expect(buttonLabelled("Add a note")).toBeUndefined();
    expect(text()).toContain("Only the developers assigned to this application can record progress");
  });

  it("offers no note field in the preview, which has no progress to record", () => {
    render("preview");

    expect(container.querySelector("textarea")).toBeNull();
    expect(buttonLabelled("Add a note")).toBeUndefined();
    expect(container.querySelector("button[aria-pressed]")?.hasAttribute("disabled")).toBe(true);
  });

  it("keeps the preview's own action available inside the same card", () => {
    render("preview");
    const start = buttonLabelled("Start remediation")!;
    expect(card().contains(start)).toBe(true);
  });
});

describe("supporting control information", () => {
  function disclosures() {
    return [...container.querySelectorAll("details")];
  }

  it("sits inside the right-side content panel on both remediation pages", () => {
    for (const page of ["preview", "detail"] as PageName[]) {
      remount();
      render(page);
      expect(disclosures().length, page).toBeGreaterThan(0);
      const supporting = container.querySelector("[data-guided-supporting]") as HTMLElement;
      expect(panel().contains(supporting), page).toBe(true);
      for (const entry of disclosures()) expect(supporting.contains(entry), page).toBe(true);
    }
  });

  it("collapses by default and says which way it opens", () => {
    render("detail");
    const about = disclosures()[0];
    expect(about.open).toBe(false);
    expect(about.querySelector("summary")?.textContent).toContain("About this control");

    act(() => {
      about.open = true;
    });
    expect(text()).toContain("Read this before you start.");
  });

  it("keeps references as external links that cannot reach back into the app", () => {
    render("detail");
    const link = [...container.querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === "https://example.test/reference",
    );
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("is never counted as a remediation step", () => {
    render("detail");
    expect(stepButtons()).toHaveLength(3);
    for (const entry of disclosures()) expect(nav().contains(entry)).toBe(false);
  });
});

describe("progress and effort in the sidebar", () => {
  it("shows one estimated-time card under the timeline and no rival progress widget", () => {
    stepRows = [
      progressRow("rotate-example-key", "completed"),
      progressRow("revoke-example-key"),
      progressRow("verify-example-key"),
    ];
    render("detail");

    const aside = container.querySelector("[data-guided-aside]") as HTMLElement;
    expect(container.querySelectorAll("[data-guided-aside]")).toHaveLength(1);
    expect(aside.textContent).toContain("Estimated time");
    expect(aside.textContent).toContain("3 steps");
    expect(aside.querySelector("svg.lucide-clock")).not.toBeNull();
    expect(container.querySelector("[role='progressbar']")).toBeNull();
    // Completion still reads from the timeline itself.
    expect(
      stepButtons()[0].querySelector("[data-guided-marker] svg.lucide-check"),
    ).not.toBeNull();
  });

  it("keeps the same sidebar card on the pages that record no progress", () => {
    for (const page of ["manual", "preview"] as PageName[]) {
      remount();
      render(page);
      const aside = container.querySelector("[data-guided-aside]") as HTMLElement;
      expect(aside.textContent, page).toContain("3 steps");
      expect(aside.querySelector("[role='progressbar']"), page).toBeNull();
    }
  });
});

describe("special states keep the same frame", () => {
  it("frames loading inside the guided card", () => {
    controlLoading = true;
    render("detail");

    expect(card().className).toContain("max-w-7xl");
    expect(text()).toContain("Loading control…");
    expect(container.querySelector("nav")).toBeNull();
  });

  it("frames a backend error inside the guided card, keeping retry and the way back", () => {
    controlErrored = true;
    render("detail");

    expect(card().className).toContain("max-w-7xl");
    expect(text()).toContain("could not provide the remediation instructions");
    expect(buttonLabelled("Retry")).toBeDefined();
    expect(container.querySelector("a[aria-label^='Back to']")).not.toBeNull();
  });

  it("explains a control with no steps without rendering an empty sidebar", () => {
    definition = control([]);
    stepRows = [];
    render("detail");

    expect(card().className).toContain("max-w-7xl");
    expect(text()).toContain("no remediation steps yet");
    expect(container.querySelector("nav")).toBeNull();
    expect(buttonLabelled("Next Step")).toBeUndefined();
    expect(buttonLabelled("Previous")).toBeUndefined();
  });

  it("explains a risk with no manual steps in the same frame", () => {
    manualSteps = [];
    render("manual");

    expect(card().className).toContain("max-w-7xl");
    expect(text()).toContain("Manual steps for this test haven't been written yet.");
    expect(container.querySelector("nav")).toBeNull();
  });
});
