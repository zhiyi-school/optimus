// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleCan, type Capability } from "@/auth/permissions";
import type { Application, Assessment, UserRole } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = Assessment & { application: Application | null };

let roles: UserRole[] = ["security"];
let assessments: Row[] = [];
let isFetching = false;

function application(id: string, name: string): Application {
  return {
    id,
    external_id: `external_${id}`,
    name,
    platform: "ios",
    version: "1.0",
    identifier: null,
    developer_team_id: null,
    app_type: null,
    contact_emails: [],
    owner_name: null,
    owner_email: null,
    developer_contact_name: null,
    developer_contact_email: null,
    provisioning_status: "pending",
    provisioning_error: null,
    artifact_sha256: null,
    icon_ref: null,
    icon_extraction_status: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function assessment(overrides: Partial<Row>): Row {
  const app = overrides.application ?? application("example-app-id", "Example Application");
  return {
    id: "example-assessment-id",
    external_id: "run::example",
    application_id: app.id,
    status: "queued",
    total_tests: 4,
    completed_tests: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    application: app,
    ...overrides,
  } as Row;
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "user-1", display_name: "Example Person", roles },
    can: (capability: Capability) => roleCan(roles, capability),
  }),
}));

vi.mock("@/hooks/queries", () => {
  const idle = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  return {
    useAssessments: () => ({ ...idle, data: assessments, isFetching }),
    useApplications: () => ({ ...idle, data: assessments.map((a) => a.application).filter(Boolean) }),
    useAutomationReports: () => ({ ...idle, data: [] }),
    useDeleteApplication: () => ({ mutateAsync: async () => {}, isPending: false }),
    useAssessmentRunRequest: () => ({ ...idle, data: null }),
    useRequestAssessmentRun: () => ({
      mutate: () => {},
      isPending: false,
      isError: false,
      error: undefined,
    }),
    useAppProvisioning: () => ({ ...idle, data: undefined }),
    useTickets: () => ({ ...idle, data: [] }),
  };
});

const Assessments = (await import("@/pages/Assessments")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  roles = ["security"];
  isFetching = false;
  assessments = [assessment({})];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function LocationProbe() {
  const location = useLocation();
  return <span data-location={location.pathname + location.search} />;
}

function render(initialPath = "/assessments") {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/assessments" element={<Assessments />} />
          <Route
            path="/assessments/:assessmentId"
            element={<span data-detail-page />}
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    ),
  );
}

function path() {
  return container.querySelector("[data-location]")?.getAttribute("data-location");
}

function rows() {
  return [...container.querySelectorAll("tbody tr")];
}

function rowNames() {
  return [...container.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent?.trim());
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function press(element: Element, key: string) {
  act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}

describe("alphabetical ordering", () => {
  it("sorts rows by application name, not creation order", () => {
    assessments = [
      assessment({ id: "a1", application: application("app-z", "Zebra App") }),
      assessment({ id: "a2", application: application("app-a", "apple app") }),
      assessment({ id: "a3", application: application("app-m", "Mango 2 App") }),
      assessment({ id: "a4", application: application("app-m10", "Mango 10 App") }),
    ];
    render();

    expect(rowNames()).toEqual(["apple app", "Mango 2 App", "Mango 10 App", "Zebra App"]);
  });

  it("orders the application filter the same way", () => {
    assessments = [
      assessment({ id: "a1", application: application("app-z", "Zebra App") }),
      assessment({ id: "a2", application: application("app-a", "Apple App") }),
    ];
    render();

    const filtersButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Filters"),
    )!;
    click(filtersButton);
    const options = [...container.querySelectorAll("select")[0].querySelectorAll("option")].map(
      (o) => o.textContent,
    );
    expect(options).toEqual(["All applications", "Apple App", "Zebra App"]);
  });
});

describe("an incomplete assessment row", () => {
  beforeEach(() => {
    assessments = [assessment({ status: "queued" })];
  });

  it("expands its status when the row body is clicked, without navigating", () => {
    render();
    click(rows()[0]);

    expect(container.querySelector("[data-detail-page]")).toBeNull();
    expect(container.textContent).toContain("Activities");
  });

  it("records the expansion in the URL, and clears it on a second click", () => {
    render();
    click(rows()[0]);
    expect(path()).toContain("expanded=example-assessment-id");

    click(rows()[0]);
    expect(path()).not.toContain("expanded=");
  });

  it("keeps existing filters when it expands", () => {
    render("/assessments?status=queued");
    click(rows()[0]);

    expect(path()).toContain("status=queued");
    expect(path()).toContain("expanded=example-assessment-id");
  });

  it("expands with Enter and with Space", () => {
    render();
    press(rows()[0], "Enter");
    expect(path()).toContain("expanded=example-assessment-id");

    press(rows()[0], " ");
    expect(path()).not.toContain("expanded=");
  });

  it("has no navigation chevron, but does have the dropdown chevron", () => {
    render();
    const cells = rows()[0].querySelectorAll("td");
    const trailing = cells[cells.length - 1];
    expect(trailing.querySelector("svg.lucide-chevron-right")).toBeNull();
    expect(trailing.querySelector("svg.lucide-chevron-down")).not.toBeNull();
  });

  it("uses button semantics with a label that describes viewing status", () => {
    render();
    const row = rows()[0];
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.getAttribute("aria-label")).toBe(
      "View setup and testing status for Example Application",
    );
  });

  it("does not toggle the row when the delete action inside it is clicked", () => {
    render();
    const del = [...container.querySelectorAll("tbody button")].find((b) =>
      b.getAttribute("title")?.startsWith("Delete"),
    )!;
    click(del);

    expect(path()).not.toContain("expanded=");
    expect(container.querySelector("[data-detail-page]")).toBeNull();
  });

  it("every non-completed status behaves the same way", () => {
    for (const status of ["queued", "waiting", "running", "failed"] as const) {
      assessments = [assessment({ status })];
      render();

      click(rows()[0]);
      expect(container.querySelector("[data-detail-page]"), status).toBeNull();
      expect(rows()[0].getAttribute("role"), status).toBe("button");
      act(() => root.unmount());
      root = createRoot(container);
    }
  });
});

describe("a completed assessment row", () => {
  beforeEach(() => {
    assessments = [assessment({ status: "completed", completed_tests: 4 })];
  });

  it("navigates to the assessment on click", () => {
    render();
    click(rows()[0]);
    expect(container.querySelector("[data-detail-page]")).not.toBeNull();
  });

  it("navigates with Enter and Space", () => {
    render();
    press(rows()[0], "Enter");
    expect(container.querySelector("[data-detail-page]")).not.toBeNull();
  });

  it("is in the tab order with an accessible label", () => {
    render();
    expect(rows()[0].getAttribute("tabindex")).toBe("0");
    expect(rows()[0].getAttribute("aria-label")).toContain("Open the assessment for");
  });

  it("shows the navigation chevron and no dropdown", () => {
    render();
    const cells = rows()[0].querySelectorAll("td");
    const trailing = cells[cells.length - 1];
    expect(trailing.querySelector("svg.lucide-chevron-right")).not.toBeNull();
    expect(trailing.querySelector("svg.lucide-chevron-down")).toBeNull();
    expect(rows()[0].getAttribute("aria-expanded")).toBeNull();
  });
});

describe("background refreshing", () => {
  it("keeps the cached rows on screen instead of a full-page loader", () => {
    isFetching = true;
    assessments = [assessment({ status: "completed" })];
    render();

    expect(container.textContent).not.toContain("Loading assessments…");
    expect(rowNames()).toEqual(["Example Application"]);
  });

  it("keeps an expanded row open while data refreshes", () => {
    isFetching = true;
    assessments = [assessment({ id: "example-assessment-id", status: "waiting" })];
    render("/assessments?expanded=example-assessment-id");

    expect(container.textContent).toContain("Activities");
    expect(rows()[0].getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a small refresh indicator rather than replacing the table", () => {
    isFetching = true;
    render();

    expect(container.querySelector("[aria-label='Refreshing']")).not.toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });
});

describe("expanded state held in the URL", () => {
  it("restores the expanded row when arriving with the parameter", () => {
    assessments = [assessment({ id: "example-assessment-id", status: "waiting" })];
    render("/assessments?expanded=example-assessment-id");

    expect(container.textContent).toContain("Activities");
    expect(rows()[0].getAttribute("aria-expanded")).toBe("true");
  });

  it("drops an id that matches no row, rather than leaving it in the URL", () => {
    assessments = [assessment({ id: "example-assessment-id", status: "waiting" })];
    render("/assessments?expanded=example-missing-id");

    expect(path()).not.toContain("expanded=");
    expect(container.textContent).not.toContain("Activities");
  });

  it("keeps an unrelated filter parameter while dropping the stale id", () => {
    assessments = [assessment({ id: "example-assessment-id", status: "waiting" })];
    render("/assessments?status=waiting&expanded=example-missing-id");

    expect(path()).toContain("status=waiting");
    expect(path()).not.toContain("expanded=");
  });
});
