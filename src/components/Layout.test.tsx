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
  it("gives a developer Resolve and Learn", () => {
    render();
    expect(labels()).toEqual(["Resolve", "Learn"]);
    expect(navLinks().find((l) => l.textContent?.trim() === "Resolve")?.getAttribute("href")).toBe(
      "/resolve",
    );
  });

  it("gives a security account Assess and Learn", () => {
    roles = ["security"];
    render();
    expect(labels()).toEqual(["Assess", "Learn"]);
  });

  it("gives a user holding both roles Assess, Resolve and Learn", () => {
    roles = ["developer", "security"];
    render();
    expect(labels()).toEqual(["Assess", "Resolve", "Learn"]);
  });

  it("offers Findings and Tickets to nobody, whatever they may still view", () => {
    for (const combination of [
      ["developer"],
      ["security"],
      ["developer", "security"],
      ["cio"],
      ["admin"],
    ] as UserRole[][]) {
      roles = combination;
      render();
      expect(labels(), combination.join("+")).not.toContain("Findings");
      expect(labels(), combination.join("+")).not.toContain("Tickets");
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it("keeps the capabilities the navigation no longer advertises", () => {
    expect(roleCan(["security"], "view_findings")).toBe(true);
    expect(roleCan(["security"], "view_tickets")).toBe(true);
    expect(roleCan(["developer"], "view_tickets")).toBe(true);
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

describe("the active tab follows the tree a route belongs to", () => {
  beforeEach(() => {
    roles = ["developer", "security"];
  });

  it.each([
    "/assessments",
    "/assessments/example-assessment-id",
    "/assessments/example-assessment-id/tests/example-feature-01-risk-01",
    "/assessments/example-assessment-id/tests/example-feature-01-risk-01/manual",
    "/runs/example-run-timestamp",
  ])("keeps Assess active on %s", (route) => {
    render(route);
    expect(active()).toEqual(["Assess"]);
  });

  it.each([
    "/resolve",
    "/resolve/applications/example-app-id",
    "/resolve/applications/example-app-id/risks/example-feature-01-risk-01",
    "/resolve/tickets/example-ticket-id",
    "/resolve/tickets/example-ticket-id/controls/example-feature-01-risk-01-control-01",
    "/resolve/findings/example-finding-id/controls/example-feature-01-risk-01-control-01",
  ])("keeps Resolve active on %s", (route) => {
    render(route);
    expect(active()).toEqual(["Resolve"]);
  });

  it("underlines nothing on a legacy route that is only passing through", () => {
    render("/findings/example-finding-id");
    expect(active()).toEqual([]);
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
    expect(labels()).toEqual(["Assess", "Resolve", "Learn", "Admin"]);
  });
});
