// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleCan, type Capability } from "@/auth/permissions";
import { formatDate } from "@/lib/utils";
import type { Application, Assessment, UserRole } from "@/database/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = Assessment & { application: Application | null };

let roles: UserRole[] = ["security"];
let assessments: Row[] = [];
let isFetching = false;
let syncingReports: string[] = [];
let failedReports: string[] = [];
let reportsFailed = false;
const reportRequests: { filters: unknown; opts: unknown }[] = [];
const assessmentListOptions: unknown[] = [];
let runRequest: unknown = null;

function application(id: string, name: string, platform: Application["platform"] = "ios"): Application {
  return {
    id,
    external_id: `external_${id}`,
    name,
    platform,
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

let conversationActivity = new Map<string, string>();

vi.mock("@/database/client", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/auth/auth-context", () => ({
  useAuth: () => ({
    profile: { id: "user-1", display_name: "Example Person", roles },
    can: (capability: Capability) => roleCan(roles, capability),
  }),
}));

vi.mock("@/hooks/queries/assessments", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/automation", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/conversations", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/evidence", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/reference", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/tickets", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/control-progress", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/playbook", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/risk-acceptance", async () => await import("@/test-support/query-hooks"));

vi.mock("@/test-support/query-hooks", () => {
  const idle = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  return {
    useConversationActivity: () => ({ ...idle, data: conversationActivity }),
    useAssessments: (opts?: unknown) => {
      assessmentListOptions.push(opts);
      return { ...idle, data: assessments, isFetching };
    },
    useApplications: () => ({ ...idle, data: assessments.map((a) => a.application).filter(Boolean) }),
    useAutomationReports: (filters: { syncStatus?: string[] }, opts?: unknown) => {
      reportRequests.push({ filters, opts });
      const data = filters.syncStatus?.includes("failed") ? failedReports : syncingReports;
      return { ...idle, data, isError: reportsFailed, error: reportsFailed ? new Error("Network Error") : undefined };
    },
    useDeleteApplication: () => ({ mutateAsync: async () => {}, isPending: false }),
    useAssessmentRunRequest: () => ({ ...idle, data: runRequest }),
    useRequestAssessmentRun: () => ({
      mutate: () => {},
      isPending: false,
      isError: false,
      error: undefined,
    }),
    useAppProvisioning: () => ({ ...idle, data: undefined }),
    useRunStatus: () => ({ ...idle, data: undefined }),
    useRunSyncStatus: () => ({ ...idle, data: undefined }),
    useAppBuilds: () => ({ ...idle, data: { builds: [], default_version: null, ambiguous: false } }),
    useRequestNewAssessment: () => ({ mutate: () => {}, isPending: false, isError: false, error: undefined }),
    useTickets: () => ({ ...idle, data: [] }),
  };
});

const Assessments = (await import("@/pages/assess/assessments")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  roles = ["security"];
  isFetching = false;
  syncingReports = [];
  failedReports = [];
  reportsFailed = false;
  reportRequests.length = 0;
  assessmentListOptions.length = 0;
  runRequest = null;
  conversationActivity = new Map();
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
  return [...container.querySelectorAll("tbody tr td:first-child span.font-medium.text-foreground")].map((name) =>
    name.textContent?.trim(),
  );
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
    expect(options).toEqual(["All applications", "Apple App (iOS)", "Zebra App (iOS)"]);
  });
});

describe("the same app on both platforms", () => {
  beforeEach(() => {
    assessments = [
      assessment({ id: "a1", status: "completed", application: application("app-ios", "Example Application", "ios") }),
      assessment({
        id: "a2",
        status: "completed",
        application: application("app-android", "Example Application", "android"),
      }),
    ];
  });

  it("labels each row with its platform, Android before iOS", () => {
    render();
    const platforms = [...container.querySelectorAll("tbody tr td:first-child")].map((td) =>
      td.textContent?.replace("Example Application", "").trim(),
    );
    expect(rowNames()).toEqual(["Example Application", "Example Application"]);
    expect(platforms).toEqual(["Android", "iOS"]);
  });

  it("names the platform in each row's accessible label", () => {
    render();
    expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual([
      "Open the assessment for Example Application (Android)",
      "Open the assessment for Example Application (iOS)",
    ]);
  });

  it("names the platform in the application filter", () => {
    render();
    const filtersButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Filters"),
    )!;
    click(filtersButton);
    const options = [...container.querySelectorAll("select")[0].querySelectorAll("option")].map(
      (o) => o.textContent,
    );
    expect(options).toEqual([
      "All applications",
      "Example Application (Android)",
      "Example Application (iOS)",
    ]);
  });

  it("names the platform in the delete confirmation", () => {
    render();
    const del = container.querySelector("[title='Delete Example Application (Android)']") as HTMLButtonElement;
    act(() => del.click());
    expect(document.body.textContent).toContain("Delete Example Application (Android)?");
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
      "View setup and testing status for Example Application (iOS)",
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

describe("an assessment that finishes while it is open", () => {
  it("keeps the list fresh while assessments are in progress", () => {
    render();

    expect(assessmentListOptions.at(-1)).toEqual({ pollWhileInProgress: true });
  });

  it("opens the assessment once the expanded row completes", () => {
    assessments = [assessment({ id: "example-assessment-id", status: "running" })];
    render("/assessments?expanded=example-assessment-id");
    expect(container.querySelector("[data-detail-page]")).toBeNull();

    assessments = [assessment({ id: "example-assessment-id", status: "completed" })];
    render();

    expect(path()).toBe("/assessments/example-assessment-id");
  });

  it("stays on the list when an assessment that is not open completes", () => {
    assessments = [
      assessment({ id: "a1", status: "running", application: application("app-a", "Apple App") }),
      assessment({ id: "a2", status: "running", application: application("app-b", "Banana App") }),
    ];
    render("/assessments?expanded=a1");

    assessments = [
      assessment({ id: "a1", status: "running", application: application("app-a", "Apple App") }),
      assessment({ id: "a2", status: "completed", application: application("app-b", "Banana App") }),
    ];
    render();

    expect(path()).toBe("/assessments?expanded=a1");
  });

  it("does not leave the list for a row that was already complete when it was opened", () => {
    assessments = [assessment({ id: "example-assessment-id", status: "completed" })];
    render("/assessments?expanded=example-assessment-id");
    render();

    expect(path()).toBe("/assessments?expanded=example-assessment-id");
  });
});

describe("a running assessment in the expanded row", () => {
  it("says tests are running without a test count", () => {
    runRequest = { id: "example-request-id", status: "completed", run_id: "example-run-id" };
    assessments = [assessment({ id: "example-assessment-id", status: "running", completed_tests: 1 })];
    render("/assessments?expanded=example-assessment-id");

    const panel = container.querySelector("tbody tr + tr")!;
    expect(panel.textContent).toContain("Tests are running on the backend.");
    expect(panel.textContent).not.toContain("security tests run");
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

describe("the automation-backend notices", () => {
  it("asks the backend for runs still syncing, polling while there are any, and for runs whose sync failed", () => {
    render();

    expect(reportRequests).toContainEqual({ filters: { syncStatus: ["queued", "running"] }, opts: { pollWhileAny: true } });
    expect(reportRequests).toContainEqual({ filters: { syncStatus: ["failed"] }, opts: undefined });
  });

  it("reports an unreachable backend on its own, in danger styling", () => {
    reportsFailed = true;
    render();

    expect((container.textContent ?? "")).toContain("Can't reach the automation backend");
    expect((container.textContent ?? "")).toContain("Network Error");
    expect(container.querySelector(".border-danger\\/30")).not.toBeNull();
  });

  it("keeps the sync notices out of the way of a connectivity failure", () => {
    reportsFailed = true;
    syncingReports = ["2026-01-09_00-00-00"];
    failedReports = ["2026-01-10_00-00-00"];
    render();

    expect((container.textContent ?? "")).toContain("Can't reach the automation backend");
    expect((container.textContent ?? "")).not.toContain("being added to the dashboard");
    expect((container.textContent ?? "")).not.toContain("could not be added");
  });

  it("says when runs are still being added to the dashboard", () => {
    syncingReports = ["2026-01-09_00-00-00"];
    render();

    expect((container.textContent ?? "")).toContain("1 completed run is being added to the dashboard.");
    expect((container.textContent ?? "")).not.toContain("could not be added");
  });

  it("pluralises the syncing notice", () => {
    syncingReports = ["2026-01-09_00-00-00", "2026-01-10_00-00-00"];
    render();

    expect((container.textContent ?? "")).toContain("2 completed runs are being added to the dashboard.");
  });

  it("warns about runs whose sync failed and links each to its run page to resync", () => {
    failedReports = ["2026-01-09_00-00-00", "2026-01-10_00-00-00"];
    render();

    expect((container.textContent ?? "")).toContain("2 completed runs could not be added to the dashboard.");
    expect(container.querySelector(".border-warning\\/30")).not.toBeNull();
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("/runs/2026-01-09_00-00-00");
    expect(links).toContain("/runs/2026-01-10_00-00-00");
  });

  it("links the first three failed runs and counts the rest", () => {
    failedReports = ["r1", "r2", "r3", "r4", "r5"];
    render();

    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links.filter((href) => href?.startsWith("/runs/"))).toEqual(["/runs/r1", "/runs/r2", "/runs/r3"]);
    expect((container.textContent ?? "")).toContain("and 2 more to resync.");
  });

  it("says nothing at all when every run has synced, whatever assessments exist", () => {
    assessments = [];
    render();

    expect((container.textContent ?? "")).not.toContain("being added to the dashboard");
    expect((container.textContent ?? "")).not.toContain("could not be added");
    expect((container.textContent ?? "")).not.toContain("Can't reach the automation backend");
  });
});

describe("the Last Updated column", () => {
  function headers() {
    return [...container.querySelectorAll("th")].map((th) => th.textContent?.trim());
  }

  it("replaces Created At", () => {
    render();
    expect(headers()).toContain("Last Updated");
    expect(headers()).not.toContain("Created At");
  });

  it("shows when the application's conversations were last updated, not when the assessment was created", () => {
    conversationActivity = new Map([["example-app-id", "2026-03-05T09:00:00Z"]]);
    render();

    expect(rows()[0].textContent).toContain(formatDate("2026-03-05T09:00:00Z"));
    expect(rows()[0].textContent).not.toContain(formatDate("2026-01-01T00:00:00Z"));
  });

  it("shows no time when the application's conversations have no entries", () => {
    render();
    expect(rows()[0].textContent).not.toContain(formatDate("2026-01-01T00:00:00Z"));
  });
});

describe("assessing a new version from the list", () => {
  const newVersionButton = () =>
    container.querySelector("[aria-label='Assess a new version of Example Application (iOS)']");

  it("offers it on a finished app and opens the version picker", () => {
    assessments = [assessment({ status: "completed" })];
    render();

    act(() => (newVersionButton() as HTMLButtonElement).click());

    expect(document.body.textContent).toContain("Assess a new version of Example Application (iOS)");
    expect(path()).toBe("/assessments");
  });

  it("does not offer it while an assessment of the app is in progress", () => {
    assessments = [
      assessment({ id: "done", status: "completed", updated_at: "2026-01-01T00:00:00Z" }),
      assessment({ id: "next", status: "queued", updated_at: "2026-01-02T00:00:00Z" }),
    ];
    render();

    expect(newVersionButton()).toBeNull();
  });

  it("is not offered to a user who cannot run tests", () => {
    roles = ["developer"];
    assessments = [assessment({ status: "completed" })];
    render();

    expect(newVersionButton()).toBeNull();
  });

  it("shows the version an assessment tested rather than the app's", () => {
    assessments = [assessment({ status: "completed", app_version: "3.9.9" })];
    render();

    const cells = [...container.querySelectorAll("tbody td")].map((td) => td.textContent);
    expect(cells).toContain("3.9.9");
    expect(cells).not.toContain("1.0");
  });
});
