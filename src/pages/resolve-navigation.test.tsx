// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TICKET = "example-ticket-id";
const APPLICATION = "example-app-id";
const RISK = "example-feature-01-risk-01";

let ticketData: Record<string, unknown> | null = null;
let ticketLoading = false;
let ticketErrored = false;

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    can: () => true,
    profile: { id: "example-user-id", roles: ["developer"] },
  }),
}));

vi.mock("@/hooks/queries/assessments", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/automation", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/conversations", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/evidence", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/reference", async () => await import("@/test-support/query-hooks"));
vi.mock("@/hooks/queries/tickets", async () => await import("@/test-support/query-hooks"));

vi.mock("@/test-support/query-hooks", () => ({
  useTicket: () => ({
    data: ticketData,
    isLoading: ticketLoading,
    isError: ticketErrored,
    refetch: () => {},
  }),
  useFinding: () => ({ data: null, isLoading: false, isError: false }),
  useFindingTickets: () => ({ data: [], isLoading: false, isError: false }),
}));

const { ResolveTicketRedirect } = await import("@/pages/LegacyRedirect");

let container: HTMLDivElement;
let root: Root;

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET,
    application_id: APPLICATION,
    type: "remediation",
    finding: { test_id: RISK },
    ...overrides,
  };
}

beforeEach(() => {
  ticketData = ticket();
  ticketLoading = false;
  ticketErrored = false;
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
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[`/resolve/tickets/${TICKET}`]}>
        <Routes>
          <Route path="/resolve/tickets/:ticketId" element={<ResolveTicketRedirect />} />
          <Route path="/resolve" element={<Landed />} />
          <Route path="/resolve/applications/:applicationId" element={<Landed />} />
          <Route
            path="/resolve/applications/:applicationId/risks/:riskId"
            element={<Landed />}
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

describe("the remediation has no page of its own", () => {
  it("sends a bookmarked ticket URL to the risk page that holds the conversation", () => {
    render();
    expect(text()).toBe(`landed:/resolve/applications/${APPLICATION}/risks/${RISK}`);
  });

  it("shows no activity or ticket detail on the way", () => {
    render();
    expect(text()).not.toContain("Activity");
    expect(text()).not.toContain("Details");
  });

  it("url-encodes a risk id that needs it", () => {
    ticketData = ticket({ finding: { test_id: "example risk/01" } });
    render();
    expect(text()).toBe(`landed:/resolve/applications/${APPLICATION}/risks/example%20risk%2F01`);
  });

  it("falls back to the application when a legacy ticket names no risk", () => {
    ticketData = ticket({ finding: null });
    render();
    expect(text()).toBe(`landed:/resolve/applications/${APPLICATION}`);
  });

  it("falls back to Resolve when a legacy ticket names neither", () => {
    ticketData = ticket({ finding: null, application_id: null });
    render();
    expect(text()).toBe("landed:/resolve");
  });

  it("falls back to Resolve when the ticket cannot be read at all", () => {
    ticketData = null;
    ticketErrored = true;
    render();
    expect(text()).toBe("landed:/resolve");
  });

  it("waits rather than redirecting somewhere wrong while the ticket loads", () => {
    ticketData = null;
    ticketLoading = true;
    render();
    expect(text()).not.toContain("landed:");
    expect(text()).toContain("Opening this remediation…");
  });

  it("keeps a mixed-role user inside Resolve rather than moving them to Assess", () => {
    ticketData = ticket({ origin_assessment_id: "example-assessment-id" });
    render();
    expect(text()).toContain("landed:/resolve/");
    expect(text()).not.toContain("/assessments/");
  });
});
