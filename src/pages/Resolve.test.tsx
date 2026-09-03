// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleCan, type Capability } from "@/auth/permissions";
import type { Finding, Ticket, TicketControl, TicketControlStep, UserRole } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP = "example-app-id";
const OTHER_APP = "example-other-app-id";
const RISK = "example-feature-01-risk-01";
const CONTROL = "example-feature-01-risk-01-control-01";
const ALTERNATIVE = "example-feature-01-risk-01-control-02";

let roles: UserRole[] = ["developer"];
let applications: unknown[] = [];
let findings: Finding[] = [];
let tickets: Ticket[] = [];
let controls: TicketControl[] = [];
let steps: TicketControlStep[] = [];
let isFetching = false;

function application(id: string, name: string, version: string | null) {
  return {
    id,
    external_id: `external_${id}`,
    name,
    platform: "ios",
    version,
    app_type: null,
    icon_ref: null,
    icon_extraction_status: null,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "example-finding-id",
    application_id: APP,
    assessment_id: "example-assessment-id",
    test_id: RISK,
    title: "Example finding",
    description: null,
    impact: null,
    severity: "high",
    status: "at_risk",
    platform: "ios",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Finding;
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "example-ticket-id",
    finding_id: "example-finding-id",
    application_id: APP,
    type: "remediation",
    status: "in_progress",
    title: "Remediate: Example finding",
    selected_control_id: CONTROL,
    risk_conversation_id: "example-conversation-id",
    origin_assessment_id: "example-assessment-id",
    withdrawn_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-03-04T00:00:00Z",
    ...overrides,
  } as Ticket;
}

function controlRow(id: string, controlId: string): TicketControl {
  return {
    id,
    ticket_id: "example-ticket-id",
    control_id: controlId,
    status: "not_started",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as TicketControl;
}

function stepRow(controlRowId: string, key: string, status: string): TicketControlStep {
  return {
    id: `${controlRowId}-${key}`,
    ticket_control_id: controlRowId,
    step_key: key,
    status,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as TicketControlStep;
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "example-developer-id", display_name: "Example Developer", roles, team_id: null },
    can: (capability: Capability) => roleCan(roles, capability),
  }),
}));

vi.mock("@/hooks/queries", () => {
  const idle = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  return {
    useApplications: () => ({ ...idle, data: applications, isFetching }),
    useFindings: ({ applicationId }: { applicationId?: string } = {}) => ({
      ...idle,
      data: applicationId
        ? findings.filter((entry) => entry.application_id === applicationId)
        : findings,
    }),
    useTickets: ({ applicationId }: { applicationId?: string } = {}) => ({
      ...idle,
      data: applicationId
        ? tickets.filter((entry) => entry.application_id === applicationId)
        : tickets,
    }),
    useTeams: () => ({ ...idle, data: [] }),
    useControlProgressForTickets: () => ({ controls, steps, isLoading: false, isError: false }),
    useLiveControlKeys: () => ({
      controlIds: new Set([CONTROL, ALTERNATIVE]),
      stepKeys: new Set(["step-one", "step-two", "alt-step-one"]),
      candidatesByRisk: new Map(),
    }),
  };
});

const Resolve = (await import("@/pages/Resolve")).default;
const ResolveApplication = (await import("@/pages/ResolveApplication")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  roles = ["developer"];
  applications = [application(APP, "Example Application", "1.4.2")];
  findings = [finding()];
  tickets = [ticket()];
  controls = [];
  steps = [];
  isFetching = false;
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

function renderList() {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/resolve"]}>
        <Routes>
          <Route path="/resolve" element={<Resolve />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    ),
  );
}

function renderApplication(applicationId = APP) {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[`/resolve/applications/${applicationId}`]}>
        <Routes>
          <Route path="/resolve/applications/:applicationId" element={<ResolveApplication />} />
          <Route
            path="/resolve/applications/:applicationId/risks/:riskId"
            element={<span data-risk-page />}
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

function path() {
  return container.querySelector("[data-location]")?.getAttribute("data-location");
}

function headers() {
  return [...container.querySelectorAll("th")].map((th) => th.textContent?.trim());
}

describe("the Resolve list", () => {
  it("presents the reference columns", () => {
    renderList();
    expect(headers()).toEqual(["App", "Version", "Progress", "Status", "Created At", ""]);
  });

  it("describes itself the way the reference does", () => {
    renderList();
    expect(text()).toContain("View and resolve findings from your application assessments.");
  });

  it("shows the application, its version and a labelled progress bar in one row", () => {
    renderList();
    expect(text()).toContain("Example Application");
    expect(text()).toContain("1.4.2");
    expect(container.querySelector("[role='progressbar']")).not.toBeNull();
  });

  it("makes the whole row activate, by keyboard as well as by pointer", () => {
    renderList();
    const row = container.querySelector("tr[role='link']") as HTMLElement;
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-label")).toContain("Example Application");
  });

  it("counts progress from the selected approach alone, not from every alternative", () => {
    controls = [controlRow("tc-1", CONTROL), controlRow("tc-2", ALTERNATIVE)];
    steps = [
      stepRow("tc-1", "step-one", "completed"),
      stepRow("tc-1", "step-two", "not_started"),
      stepRow("tc-2", "alt-step-one", "completed"),
    ];
    renderList();

    const bar = container.querySelector("[role='progressbar']") as HTMLElement;
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(text()).toContain("1 of 2");
  });

  it("sorts by application name, not by how much action a row needs", () => {
    applications = [
      application(OTHER_APP, "Zebra Application", "2.0"),
      application(APP, "Alpha Application", "1.4.2"),
    ];
    // Zebra needs action (at_risk) and Alpha does not — alphabetical order still wins.
    findings = [
      finding({ application_id: OTHER_APP, status: "at_risk" }),
      finding({ id: "other", application_id: APP, status: "reduced_risk" }),
    ];
    renderList();

    const names = [...container.querySelectorAll("tbody tr td:first-child")].map((td) =>
      td.textContent?.trim(),
    );
    expect(names).toEqual(["Alpha Application", "Zebra Application"]);
  });

  it("orders names case-insensitively and numerically", () => {
    applications = [
      application(OTHER_APP, "app 10", "1.0"),
      application(APP, "App 2", "1.0"),
    ];
    findings = [];
    renderList();

    const names = [...container.querySelectorAll("tbody tr td:first-child")].map((td) =>
      td.textContent?.trim(),
    );
    expect(names).toEqual(["App 2", "app 10"]);
  });

  it("has no intermediate overview between the list and the work", () => {
    renderList();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs.some((href) => href?.startsWith("/findings"))).toBe(false);
    expect(hrefs.some((href) => href?.startsWith("/tickets"))).toBe(false);
  });

  it("says so plainly when the team owns no applications", () => {
    applications = [];
    renderList();
    expect(text()).toContain("No applications are assigned to your team yet");
    expect(container.querySelector("table")).toBeNull();
  });

  it("offers a compact card list as well as the table, for narrow screens", () => {
    renderList();
    const cards = container.querySelectorAll("ul.md\\:hidden > li > button");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("Example Application");
  });
});

describe("background refreshing", () => {
  it("keeps the cached rows on screen instead of a full-page loader", () => {
    isFetching = true;
    renderList();

    expect(text()).not.toContain("Loading your applications…");
    expect(text()).toContain("Example Application");
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("shows a small refresh indicator while fetching", () => {
    isFetching = true;
    renderList();

    expect(container.querySelector("[aria-label='Refreshing']")).not.toBeNull();
  });
});

describe("opening an application from Resolve", () => {
  it("goes straight to the feature-risk that needs action, with no overview in between", () => {
    renderApplication();
    expect(path()).toBe(`/resolve/applications/${APP}/risks/${RISK}`);
    expect(container.querySelector("[data-risk-page]")).not.toBeNull();
  });

  it("shows no metrics overview on the way", () => {
    renderApplication();
    expect(text()).not.toContain("Findings needing action");
    expect(text()).not.toContain("Findings by severity");
  });

  it("prefers a finding with no remediation yet over one already under way", () => {
    findings = [
      finding({ id: "started", test_id: "example-feature-01-risk-01" }),
      finding({ id: "fresh", test_id: "example-feature-01-risk-09" }),
    ];
    tickets = [ticket({ finding_id: "started" })];
    renderApplication();

    expect(path()).toBe(`/resolve/applications/${APP}/risks/example-feature-01-risk-09`);
  });

  it("escapes the risk id rather than trusting it in the path", () => {
    findings = [finding({ test_id: "example/risk" })];
    renderApplication();
    expect(path()).toContain("%2F");
  });

  it("says so deliberately when an application has nothing to remediate", () => {
    findings = [];
    tickets = [];
    renderApplication();

    expect(path()).toBe(`/resolve/applications/${APP}`);
    expect(text()).toContain("Nothing to remediate on this application");
  });

  it("refuses an application outside the developer's scope rather than guessing", () => {
    renderApplication(OTHER_APP);
    expect(text()).toContain("Unable to load this application.");
    expect(container.querySelector("[data-risk-page]")).toBeNull();
  });
});
