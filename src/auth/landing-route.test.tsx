// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRouteFor, resolveAccess } from "@/auth/permissions";
import type { Profile, UserRole } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roles: UserRole[] = ["developer"];
let loading = false;
let hasSession = true;
let teamId: string | null = "example-team-id";

function profile(): Profile | null {
  if (loading) return null;
  return {
    id: "00000000-0000-0000-0000-000000000001",
    display_name: "Example Person",
    email: "person@example.test",
    roles,
    team_id: teamId,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: { from: () => ({}), auth: {}, storage: { from: () => ({}) } },
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    session: hasSession ? { access_token: "example-token" } : null,
    profile: profile(),
    loading,
    signIn: () => Promise.resolve(),
    signUp: () => Promise.resolve({ requiresEmailConfirmation: false }),
    can: () => false,
  }),
}));

const Login = (await import("@/pages/Login")).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  roles = ["developer"];
  loading = false;
  hasSession = true;
  teamId = "example-team-id";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Landed({ label }: { label: string }) {
  return <p>{label}</p>;
}

function render() {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Landed label="landed:dashboard" />} />
          <Route path="/resolve" element={<Landed label="landed:resolve" />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

describe("the landing route waits for the profile", () => {
  it("does not route on a session whose profile is still loading", () => {
    loading = true;
    render();

    expect(text()).not.toContain("landed:dashboard");
    expect(text()).not.toContain("landed:resolve");
  });

  it("keeps a loading state visible instead of the sign-in form", () => {
    loading = true;
    render();

    expect(text()).toContain("Loading your workspace…");
    expect(container.querySelector("input[type='password']")).toBeNull();
  });

  it("sends the developer to Resolve once the profile arrives", () => {
    loading = true;
    render();
    loading = false;
    render();

    expect(text()).toContain("landed:resolve");
    expect(text()).not.toContain("landed:dashboard");
  });

  it("still shows the sign-in form when there is no session at all", () => {
    hasSession = false;
    render();

    expect(container.querySelector("input[type='password']")).not.toBeNull();
    expect(text()).not.toContain("landed:");
  });
});

describe("where each role lands", () => {
  const developerCombinations: UserRole[][] = [
    ["developer"],
    ["developer", "security"],
    ["developer", "admin"],
    ["developer", "cio"],
  ];

  it.each(developerCombinations)("sends %s to Resolve", (...combination) => {
    roles = combination as UserRole[];
    render();
    expect(text()).toContain("landed:resolve");
  });

  it.each([["security"], ["cio"], ["admin"]] as UserRole[][])(
    "leaves %s on the shared dashboard",
    (...combination) => {
      roles = combination as UserRole[];
      render();
      expect(text()).toContain("landed:dashboard");
    },
  );

  it("keeps a developer with no team on Resolve, where the setup state lives", () => {
    teamId = null;
    render();

    expect(text()).toContain("landed:resolve");
    expect(resolveAccess({ roles: ["developer"], team_id: null })).toBe("no_team");
  });

  it("never sends a non-developer to Resolve, so no loop can form", () => {
    for (const combination of [["security"], ["cio"], ["admin"]] as UserRole[][]) {
      expect(defaultRouteFor({ roles: combination, team_id: "example-team-id" })).toBe("/");
      expect(resolveAccess({ roles: combination, team_id: "example-team-id" })).toBe("unauthorized");
    }
  });

  it("routes to a destination that is never the login page it came from", () => {
    for (const combination of [...developerCombinations, ["security"]] as UserRole[][]) {
      expect(defaultRouteFor({ roles: combination, team_id: "example-team-id" })).not.toBe("/login");
    }
  });
});
