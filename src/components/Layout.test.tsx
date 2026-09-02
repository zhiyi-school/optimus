// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleCan, type Capability } from "@/auth/permissions";
import type { Profile, UserRole } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roles: UserRole[] = ["developer"];

function profile(): Profile {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    display_name: "Example Developer",
    email: "developer@example.test",
    roles,
    team_id: "example-team-id",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    profile: profile(),
    can: (capability: Capability) => roleCan(roles, capability),
    signOut: () => Promise.resolve(),
  }),
}));

vi.mock("@/hooks/queries", () => ({
  useTeams: () => ({ data: [{ id: "example-team-id", name: "Example Developer Team" }] }),
}));

const { Layout } = await import("@/components/Layout");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  roles = ["developer"];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(at = "/") {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <Layout />
      </MemoryRouter>,
    ),
  );
}

function navLinks() {
  return [...container.querySelectorAll("nav[aria-label='Main'] a")];
}

function labels() {
  return navLinks().map((link) => link.textContent?.trim());
}

function active() {
  return navLinks()
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent?.trim());
}

describe("navigation items", () => {
  it("shows Findings to a user who may view findings", () => {
    render();
    expect(labels()).toContain("Findings");
    expect(navLinks().find((l) => l.textContent?.trim() === "Findings")?.getAttribute("href")).toBe(
      "/findings",
    );
  });

  it("hides Findings from a user who may not view findings", () => {
    roles = ["admin"];
    render();
    expect(roleCan(roles, "view_findings")).toBe(false);
    expect(labels()).not.toContain("Findings");
  });

  it("gives a developer their own areas and nothing security owns", () => {
    render();
    expect(labels()).toEqual(["Findings", "Resolve", "Tickets", "Learn"]);
  });

  it("gives a security account Assess and Findings but not Resolve", () => {
    roles = ["security"];
    render();
    expect(labels()).toEqual(["Assess", "Findings", "Tickets", "Learn"]);
  });

  it("gives a multi-role user every area their capabilities allow", () => {
    roles = ["developer", "security"];
    render();
    expect(labels()).toEqual(["Assess", "Findings", "Resolve", "Tickets", "Learn"]);
  });

  it("adds Admin only for an account holding the admin role", () => {
    roles = ["developer", "admin"];
    render();
    expect(labels()).toContain("Admin");
  });

  it("keeps Learn available to everyone", () => {
    for (const role of ["developer", "security", "cio", "admin"] as UserRole[]) {
      roles = [role];
      render();
      expect(labels(), role).toContain("Learn");
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it("gates every item on a capability, so no item survives a roleless profile", () => {
    roles = [];
    render();
    expect(labels()).toEqual(["Learn"]);
  });
});

describe("Findings is active across the finding routes", () => {
  it("is active on the findings list", () => {
    render("/findings");
    expect(active()).toEqual(["Findings"]);
  });

  it("is active on a finding's detail page", () => {
    render("/findings/example-finding-id");
    expect(active()).toEqual(["Findings"]);
  });

  it("is active on a pre-ticket control preview", () => {
    render("/findings/example-finding-id/controls/example-feature-01-risk-01-control-01");
    expect(active()).toEqual(["Findings"]);
  });

  it("leaves Resolve owning its own preview route", () => {
    render("/resolve/findings/example-finding-id/controls/example-feature-01-risk-01-control-01");
    expect(active()).toEqual(["Resolve"]);
  });

  it("does not claim the tickets tree", () => {
    render("/tickets/example-ticket-id");
    expect(active()).toEqual(["Tickets"]);
  });
});

describe("one navigation for every viewport", () => {
  it("renders a single nav, so narrow screens cannot get a different permission set", () => {
    roles = ["developer", "security"];
    render();
    expect(container.querySelectorAll("nav")).toHaveLength(1);
  });

  it("keeps every item reachable when they outgrow the bar", () => {
    roles = ["developer", "security", "admin"];
    render();
    const nav = container.querySelector("nav[aria-label='Main']");
    expect(nav?.className).toContain("overflow-x-auto");
    expect(labels()).toHaveLength(6);
  });
});
