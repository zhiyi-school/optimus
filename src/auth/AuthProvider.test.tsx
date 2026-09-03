// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";

type AuthEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED";

let emit: (event: AuthEvent, session: unknown) => void = () => {};
let unsubscribes = 0;
let getSessionCalls = 0;
let profileCalls: string[] = [];
let nextProfile: (userId: string) => Promise<Profile | null>;

function profileFor(userId: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id: userId,
    display_name: userId === USER_A ? "Example Person A" : "Example Person B",
    email: userId === USER_A ? "a@example.test" : "b@example.test",
    roles: userId === USER_A ? ["security"] : ["developer"],
    team_id: "example-team-id",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Profile;
}

function sessionFor(userId: string, token = "example-token") {
  return { access_token: token, user: { id: userId } };
}

vi.mock("@/data/supabase", () => ({
  ATTACHMENTS_BUCKET: "ticket-attachments",
  EVIDENCE_BUCKET: "evidence",
  supabase: {
    from: () => ({}),
    storage: { from: () => ({}) },
    auth: {
      onAuthStateChange: (cb: (event: AuthEvent, session: unknown) => void) => {
        emit = cb;
        return { data: { subscription: { unsubscribe: () => (unsubscribes += 1) } } };
      },
      getSession: () => {
        getSessionCalls += 1;
        return Promise.resolve({ data: { session: null } });
      },
      signOut: () => Promise.resolve({ error: null }),
      signInWithPassword: () => Promise.resolve({ error: null }),
      signUp: () => Promise.resolve({ data: {}, error: null }),
    },
  },
}));

vi.mock("@/data/services", () => ({
  userData: {
    getCurrentProfile: () => {
      const userId = currentUserId;
      profileCalls.push(userId ?? "none");
      return nextProfile(userId ?? "none");
    },
  },
}));

/** Mirrors what the mocked backend would return for the signed-in user. */
let currentUserId: string | null = null;

const { AuthProvider } = await import("@/auth/AuthProvider");
const { useAuth } = await import("@/auth/useAuth");

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let cacheClears: number;

function Probe() {
  const { profile, loading, profileRefreshing, session, profileError } = useAuth();
  return (
    <span
      data-loading={String(loading)}
      data-refreshing={String(profileRefreshing)}
      data-profile={profile?.display_name ?? "none"}
      data-roles={(profile?.roles ?? []).join(",") || "none"}
      data-token={(session as { access_token?: string } | null)?.access_token ?? "none"}
      data-error={profileError ?? "none"}
    />
  );
}

function probe() {
  return container.querySelector("span")!;
}

async function mount() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    ),
  );
}

async function fire(event: AuthEvent, session: unknown) {
  await act(async () => {
    emit(event, session);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  unsubscribes = 0;
  getSessionCalls = 0;
  profileCalls = [];
  currentUserId = null;
  cacheClears = 0;
  nextProfile = (userId) => Promise.resolve(profileFor(userId));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const clear = client.clear.bind(client);
  client.clear = () => {
    cacheClears += 1;
    clear();
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("initialization", () => {
  it("blocks until the first session decision arrives", async () => {
    await mount();
    expect(probe().getAttribute("data-loading")).toBe("true");
  });

  it("loads the profile once for the initial session", async () => {
    currentUserId = USER_A;
    await mount();
    await fire("INITIAL_SESSION", sessionFor(USER_A));

    expect(profileCalls).toEqual([USER_A]);
    expect(probe().getAttribute("data-profile")).toBe("Example Person A");
    expect(probe().getAttribute("data-loading")).toBe("false");
  });

  it("never calls getSession, so the initial profile cannot load twice", async () => {
    currentUserId = USER_A;
    await mount();
    await fire("INITIAL_SESSION", sessionFor(USER_A));

    expect(getSessionCalls).toBe(0);
    expect(profileCalls).toHaveLength(1);
  });

  it("stops blocking when the initial session is absent", async () => {
    await mount();
    await fire("INITIAL_SESSION", null);

    expect(probe().getAttribute("data-loading")).toBe("false");
    expect(probe().getAttribute("data-profile")).toBe("none");
    expect(profileCalls).toEqual([]);
  });

  it("loads the profile on a first sign-in", async () => {
    await mount();
    await fire("INITIAL_SESSION", null);
    currentUserId = USER_A;
    await fire("SIGNED_IN", sessionFor(USER_A));

    expect(profileCalls).toEqual([USER_A]);
    expect(probe().getAttribute("data-profile")).toBe("Example Person A");
  });

  it("releases the subscription on unmount", async () => {
    await mount();
    act(() => root.unmount());
    expect(unsubscribes).toBe(1);
    root = createRoot(container);
  });
});

describe("events for an already-established user", () => {
  async function established() {
    currentUserId = USER_A;
    await mount();
    await fire("INITIAL_SESSION", sessionFor(USER_A));
    profileCalls = [];
  }

  it("updates the session silently on a token refresh", async () => {
    await established();
    await fire("TOKEN_REFRESHED", sessionFor(USER_A, "example-refreshed-token"));

    expect(probe().getAttribute("data-token")).toBe("example-refreshed-token");
    expect(probe().getAttribute("data-loading")).toBe("false");
    expect(probe().getAttribute("data-profile")).toBe("Example Person A");
  });

  it("does not reload the profile on a token refresh", async () => {
    await established();
    await fire("TOKEN_REFRESHED", sessionFor(USER_A, "example-refreshed-token"));

    expect(profileCalls).toEqual([]);
  });

  it("keeps the authenticated tree mounted across a token refresh", async () => {
    let mounts = 0;
    function MountCounter() {
      const { loading } = useAuth();
      useEffect(() => {
        mounts += 1;
      }, []);
      return <span data-mounted={String(!loading)} />;
    }

    currentUserId = USER_A;
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AuthProvider>
            <MountCounter />
          </AuthProvider>
        </QueryClientProvider>,
      ),
    );
    await fire("INITIAL_SESSION", sessionFor(USER_A));
    expect(mounts).toBe(1);

    await fire("TOKEN_REFRESHED", sessionFor(USER_A, "example-refreshed-token"));
    await fire("SIGNED_IN", sessionFor(USER_A));

    expect(mounts).toBe(1);
  });

  it("does not block or refetch on a duplicate sign-in for the same user", async () => {
    await established();
    await fire("SIGNED_IN", sessionFor(USER_A));

    expect(profileCalls).toEqual([]);
    expect(probe().getAttribute("data-loading")).toBe("false");
  });

  it("refreshes the profile on a user update without clearing it", async () => {
    await established();
    let resolveRefresh: (value: Profile) => void = () => {};
    nextProfile = () => new Promise((resolve) => (resolveRefresh = resolve));

    await fire("USER_UPDATED", sessionFor(USER_A));
    expect(probe().getAttribute("data-profile")).toBe("Example Person A");
    expect(probe().getAttribute("data-loading")).toBe("false");
    expect(probe().getAttribute("data-refreshing")).toBe("true");

    await act(async () => {
      resolveRefresh(profileFor(USER_A, { display_name: "Example Person A (updated)" }));
      await Promise.resolve();
    });
    expect(probe().getAttribute("data-profile")).toBe("Example Person A (updated)");
    expect(probe().getAttribute("data-refreshing")).toBe("false");
  });

  it("keeps the current profile and roles when a background refresh fails", async () => {
    await established();
    nextProfile = () => Promise.reject(new Error("Example network failure."));
    await fire("USER_UPDATED", sessionFor(USER_A));

    expect(probe().getAttribute("data-profile")).toBe("Example Person A");
    expect(probe().getAttribute("data-roles")).toBe("security");
    expect(probe().getAttribute("data-loading")).toBe("false");
  });
});

describe("signing out and switching accounts", () => {
  it("clears the profile and the cached account data on sign-out", async () => {
    currentUserId = USER_A;
    await mount();
    await fire("INITIAL_SESSION", sessionFor(USER_A));
    client.setQueryData(["assessments"], [{ id: "example-assessment-id" }]);

    await fire("SIGNED_OUT", null);

    expect(probe().getAttribute("data-profile")).toBe("none");
    expect(cacheClears).toBe(1);
    expect(client.getQueryData(["assessments"])).toBeUndefined();
  });

  it("never shows the previous account's profile after a different user signs in", async () => {
    currentUserId = USER_A;
    await mount();
    await fire("INITIAL_SESSION", sessionFor(USER_A));

    currentUserId = USER_B;
    let resolveB: (value: Profile) => void = () => {};
    nextProfile = () => new Promise((resolve) => (resolveB = resolve));
    await fire("SIGNED_IN", sessionFor(USER_B));

    expect(probe().getAttribute("data-profile")).toBe("none");
    expect(cacheClears).toBe(1);

    await act(async () => {
      resolveB(profileFor(USER_B));
      await Promise.resolve();
    });
    expect(probe().getAttribute("data-profile")).toBe("Example Person B");
    expect(probe().getAttribute("data-roles")).toBe("developer");
  });

  it("discards a slow profile response that a newer session superseded", async () => {
    const pending: ((value: Profile) => void)[] = [];
    nextProfile = () => new Promise((resolve) => pending.push(resolve));

    currentUserId = USER_A;
    await mount();
    await fire("INITIAL_SESSION", sessionFor(USER_A));

    currentUserId = USER_B;
    await fire("SIGNED_IN", sessionFor(USER_B));

    // The first user's request lands last; it must not become the profile.
    await act(async () => {
      pending[0](profileFor(USER_A));
      await Promise.resolve();
    });
    expect(probe().getAttribute("data-profile")).not.toBe("Example Person A");

    await act(async () => {
      pending[1](profileFor(USER_B));
      await Promise.resolve();
    });
    expect(probe().getAttribute("data-profile")).toBe("Example Person B");
  });

  it("does not restore a profile that resolves after signing out", async () => {
    let resolveSlow: (value: Profile) => void = () => {};
    nextProfile = () => new Promise((resolve) => (resolveSlow = resolve));

    currentUserId = USER_A;
    await mount();
    await fire("INITIAL_SESSION", sessionFor(USER_A));
    await fire("SIGNED_OUT", null);

    await act(async () => {
      resolveSlow(profileFor(USER_A));
      await Promise.resolve();
    });
    expect(probe().getAttribute("data-profile")).toBe("none");
  });
});

describe("a failed initial profile load", () => {
  it("stops blocking and reports the error rather than hanging", async () => {
    currentUserId = USER_A;
    nextProfile = () => Promise.reject(new Error("Example profile failure."));
    await mount();
    await fire("INITIAL_SESSION", sessionFor(USER_A));

    expect(probe().getAttribute("data-loading")).toBe("false");
    expect(probe().getAttribute("data-profile")).toBe("none");
    expect(probe().getAttribute("data-error")).toBe("Example profile failure.");
  });
});
