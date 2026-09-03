// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, Assessment } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHA = "a".repeat(64);

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: "example-app-id",
    external_id: "example_app",
    name: "Example Application",
    platform: "ios",
    version: "1.0",
    identifier: "com.example.placeholder",
    developer_team_id: "example-team-id",
    app_type: "Banking",
    contact_emails: [],
    owner_name: null,
    owner_email: null,
    developer_contact_name: null,
    developer_contact_email: null,
    provisioning_status: "ready",
    provisioning_error: null,
    artifact_sha256: SHA,
    icon_ref: `icons/${SHA}.png`,
    icon_extraction_status: "available",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Application;
}

function assessmentRow(
  app: Application | null,
  overrides: Partial<Assessment> = {},
): Assessment & { application: Application | null } {
  return {
    id: "example-assessment-id",
    external_id: "run::example_app",
    application_id: "example-app-id",
    status: "completed",
    total_tests: 4,
    completed_tests: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    application: app,
    ...overrides,
  } as Assessment & { application: Application | null };
}

let rows: (Assessment & { application: Application | null })[] = [];

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

let addApp: () => Promise<unknown>;
let invalidated: unknown[];

vi.mock("@/data/sync", () => ({ syncService: { addApp: () => addApp() } }));

vi.mock("@/hooks/queries", () => ({
  useAssessments: () => ({ data: rows, isLoading: false, isError: false }),
}));

const NewAssessment = (await import("@/pages/NewAssessment")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  rows = [assessmentRow(application())];
  addApp = () => Promise.resolve({ assessment: { id: "example-assessment-id" }, ticket: null });
  invalidated = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Landed() {
  return <p>{`landed:${useLocation().pathname}`}</p>;
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.invalidateQueries = (filters) => {
    invalidated.push((filters as { queryKey?: unknown[] })?.queryKey?.[0]);
    return Promise.resolve();
  };
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/assessments/new"]}>
          <Routes>
            <Route path="/assessments/new" element={<NewAssessment />} />
            <Route path="/assessments" element={<Landed />} />
            <Route path="/assessments/:assessmentId" element={<Landed />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

function sidebar() {
  return container.querySelector("aside") as HTMLElement;
}

function buttons() {
  return [...container.querySelectorAll("button")];
}

function buttonNamed(label: string) {
  return buttons().find((button) => button.textContent?.trim().startsWith(label));
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function goToReview() {
  render();
  act(() => setValue(container.querySelector("input") as HTMLInputElement, "Example Application"));
  act(() => buttonNamed("custom-appsec")?.click());
  act(() => buttonNamed("Next")?.click());
}

async function submit() {
  goToReview();
  await act(async () => {
    buttonNamed("Confirm & Create Assessment")?.click();
  });
}

describe("the New Assessment sidebar", () => {
  it("lists assessments beside the form rather than on a page of its own", () => {
    render();
    expect(sidebar()).not.toBeNull();
    expect(sidebar().textContent).toContain("Example Application");
    expect(sidebar().querySelector("a")?.getAttribute("href")).toBe("/assessments/example-assessment-id");
  });

  it("keeps the progress, platform, status and date the list already showed", () => {
    render();
    const listed = sidebar().textContent ?? "";
    expect(listed).toContain("2 of 4");
    expect(listed).toContain("iOS");
    expect(listed).toContain("Completed");
    expect(listed).toContain("Jan 01, 2026");
    expect(sidebar().querySelector("[style*='width: 50%']")).not.toBeNull();
  });

  it("scrolls in place, bounded, on narrow screens", () => {
    const list = () => sidebar().querySelector("ul") as HTMLElement;
    render();
    expect(list().className).toContain("overflow-y-auto");
    expect(list().className).toContain("max-h-[22rem]");
  });

  it("stretches to fill the form's height and scrolls only the list on desktop", () => {
    const list = () => sidebar().querySelector("ul") as HTMLElement;
    render();
    expect(sidebar().className).toContain("lg:flex");
    expect(sidebar().className).toContain("lg:flex-col");
    expect(list().className).toContain("lg:min-h-0");
    expect(list().className).toContain("lg:flex-1");
    expect(list().className).toContain("lg:max-h-none");
  });

  it("keeps its heading out of the scrolling list", () => {
    render();
    const heading = sidebar().querySelector("h2") as HTMLElement;
    expect(heading.textContent).toBe("Assessments");
    expect(heading.closest("ul")).toBeNull();
  });

  it("takes a bounded desktop width and leaves the form the rest", () => {
    render();
    const grid = sidebar().parentElement as HTMLElement;
    expect(grid.className).toContain("lg:grid-cols-[18rem_minmax(0,1fr)]");
    expect(grid.className).toContain("xl:grid-cols-[20rem_minmax(0,1fr)]");
    expect(grid.className).toContain("lg:min-h-[30rem]");
  });

  it("stacks in one column before the desktop breakpoint", () => {
    render();
    const grid = sidebar().parentElement as HTMLElement;
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("lg:grid-cols-[");
  });

  it("reserves room for the scrollbar so it never sits over a row", () => {
    render();
    const list = sidebar().querySelector("ul") as HTMLElement;
    expect(list.className).toContain("[scrollbar-gutter:stable]");
    expect(list.className).toContain("pr-3");
  });

  it("keeps rows inside the scroll container rather than under the scrollbar", () => {
    render();
    const link = sidebar().querySelector("a") as HTMLAnchorElement;
    expect(link.className).not.toContain("-mx-");
    expect(link.className).toContain("focus-visible:ring");
  });

  it("cannot be widened by a long name, identifier or status", () => {
    rows = [
      assessmentRow(
        application({
          name: "Example".repeat(40),
          identifier: "com.example.placeholder".repeat(10),
        }),
      ),
    ];
    render();

    expect(sidebar().className).toContain("min-w-0");
    expect(sidebar().querySelector(".truncate")).not.toBeNull();
    expect(sidebar().querySelector("ul")?.className).toContain("overflow-x-hidden");
  });

  it("keeps each row focusable with a visible focus ring", () => {
    render();
    const link = sidebar().querySelector("a") as HTMLAnchorElement;
    expect(link.className).toContain("focus-visible:ring");
    expect(link.getAttribute("href")).toBe("/assessments/example-assessment-id");
  });

  it("renders the extracted icon for an application that has one", () => {
    render();
    const image = sidebar().querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toContain("/config/ios/apps/example_app/icon");
  });

  it("falls back to the generic application icon when there is none", () => {
    rows = [assessmentRow(application({ icon_ref: null, icon_extraction_status: "unavailable" }))];
    render();
    expect(sidebar().querySelector("img")).toBeNull();
    expect(sidebar().querySelector("svg")).not.toBeNull();
  });

  it("falls back when the icon request fails", () => {
    render();
    const image = sidebar().querySelector("img") as HTMLImageElement;
    act(() => image.dispatchEvent(new Event("error", { bubbles: false })));
    expect(sidebar().querySelector("img")).toBeNull();
    expect(sidebar().querySelector("svg")).not.toBeNull();
  });

  it("never puts image data or a storage path in the document", () => {
    render();
    expect(container.innerHTML).not.toContain("data:image");
    expect(container.innerHTML).not.toContain("icons/");
  });
});

describe("an incomplete assessment in the mini list", () => {
  it("does not open assessment results", () => {
    rows = [assessmentRow(application(), { status: "running" })];
    render();
    expect(sidebar().querySelector("a")).toBeNull();
  });

  it("still shows its name, status and progress", () => {
    rows = [assessmentRow(application(), { status: "running" })];
    render();
    const listed = sidebar().textContent ?? "";
    expect(listed).toContain("Example Application");
    expect(listed).toContain("Assessing in progress");
    expect(listed).toContain("2 of 4");
  });
});

describe("connector availability", () => {
  it("describes a usable connector as available and keeps it selectable", () => {
    render();
    const connector = buttonNamed("custom-appsec") as HTMLButtonElement;
    expect(connector.textContent).toContain("Available");
    expect(connector.textContent).not.toContain("Unavailable");
    expect(connector.disabled).toBe(false);
  });

  it("describes the others as unavailable and leaves them disabled", () => {
    render();
    for (const name of ["mobsf", "owasp-zap"]) {
      const connector = buttonNamed(name) as HTMLButtonElement;
      expect(connector.textContent, name).toContain("Unavailable");
      expect(connector.disabled, name).toBe(true);
    }
  });

  it("no longer uses connection wording anywhere on the page", () => {
    render();
    expect(text()).not.toContain("Connected");
    expect(text()).not.toContain("Not connected");
  });

  it("carries the same wording into the review summary", () => {
    goToReview();
    expect(text()).toContain("Available");
    expect(text()).not.toContain("Connected");
  });
});

describe("Review & Confirm", () => {
  it("keeps its title and description", () => {
    goToReview();
    expect(container.querySelector("h1")?.textContent).toBe("Review & Confirm");
    expect(text()).toContain("Review all details before creating this security assessment.");
  });

  it("has no back arrow in the header", () => {
    goToReview();
    const header = container.querySelector("h1")?.closest("div")?.parentElement as HTMLElement;
    expect(header.querySelector("button")).toBeNull();
  });

  it("keeps the close link in the header", () => {
    goToReview();
    const close = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(close).toContain("/assessments");
  });

  it("keeps a single back control, in the footer", () => {
    goToReview();
    expect(buttons().filter((b) => b.textContent?.trim() === "Back")).toHaveLength(1);
  });

  it("returns to the editable form from the footer Back button", () => {
    goToReview();
    act(() => buttonNamed("Back")?.click());

    expect(container.querySelector("h1")?.textContent).toBe("New Assessment");
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("Example Application");
  });

  it("still offers the confirm action", () => {
    goToReview();
    expect(buttonNamed("Confirm & Create Assessment")).not.toBeUndefined();
  });
});

describe("where a created assessment leaves you", () => {
  it("returns to the main Assessments page rather than the new assessment's own page", async () => {
    await submit();

    expect(text()).toContain("landed:/assessments");
    expect(text()).not.toContain("landed:/assessments/example-assessment-id");
  });

  it("refreshes the overview's data before landing there", async () => {
    await submit();

    expect(invalidated).toEqual(
      expect.arrayContaining(["assessments", "applications", "ticketsWithRelations", "dashboardMetrics"]),
    );
  });

  it("stays on the form and shows the error when creation fails", async () => {
    addApp = () => Promise.reject(new Error("Example backend refused the request."));
    await submit();

    expect(text()).not.toContain("landed:");
    expect(text()).toContain("Unable to add app.");
    expect(buttonNamed("Confirm & Create Assessment")).not.toBeUndefined();
  });

  it("does not navigate away from a failure, so nothing created is stranded", async () => {
    addApp = () => Promise.reject(new Error("Example backend refused the request."));
    await submit();

    expect(container.querySelector("h1")?.textContent).toBe("Review & Confirm");
  });
});
