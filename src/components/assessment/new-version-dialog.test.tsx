// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBuilds } from "@/automation-api/types";
import type { Application } from "@/database/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let builds: { data: AppBuilds | null | undefined; isLoading: boolean; isError: boolean };
const buildRequests: { platform: unknown; appId: unknown; enabled: unknown }[] = [];
const started: { applicationId: string; buildVersion: string | null }[] = [];
let startError: Error | null = null;

vi.mock("@/hooks/queries/automation", () => ({
  useAppBuilds: (platform: unknown, appId: unknown, enabled: unknown) => {
    buildRequests.push({ platform, appId, enabled });
    return builds;
  },
}));

vi.mock("@/hooks/queries/assessments", () => ({
  useRequestNewAssessment: () => ({
    isPending: false,
    isError: !!startError,
    error: startError,
    mutate: (
      variables: { applicationId: string; buildVersion: string | null },
      options: { onSuccess: (assessment: { id: string }) => void },
    ) => {
      started.push(variables);
      options.onSuccess({ id: "new-assessment-id" });
    },
  }),
}));

const { NewVersionDialog } = await import("@/components/assessment/new-version-dialog");

let container: HTMLDivElement;
let root: Root;
let openState: boolean[];

function application(platform: Application["platform"]): Application {
  return { id: "app-id", name: "Example App", platform, external_id: "example_app" } as Application;
}

function LocationProbe() {
  const location = useLocation();
  return <span data-location={location.pathname + location.search} />;
}

function render(app: Application) {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/assessments/current"]}>
        <Routes>
          <Route
            path="*"
            element={<NewVersionDialog application={app} open onOpenChange={(open) => openState.push(open)} />}
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    ),
  );
}

function text() {
  return document.body.textContent ?? "";
}

function button(label: string) {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;
}

beforeEach(() => {
  builds = {
    isLoading: false,
    isError: false,
    data: {
      builds: [
        { version: "4.3.4", build_number: "12", file: "Example_4.3.4.ipa", modified_at: 1 },
        { version: "3.9.9", build_number: "8", file: "Example_3.9.9.ipa", modified_at: 2 },
      ],
      default_version: "4.3.4",
      ambiguous: false,
    },
  };
  buildRequests.length = 0;
  started.length = 0;
  startError = null;
  openState = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("assessing a new iOS version", () => {
  it("preselects the highest version and lists every version", () => {
    render(application("ios"));

    const select = document.body.querySelector("select")!;
    expect(select.value).toBe("4.3.4");
    expect([...select.options].map((option) => option.textContent)).toEqual(["4.3.4 (highest)", "3.9.9"]);
    expect(text()).toContain("4.3.4 (build 12) — Example_4.3.4.ipa");
    expect(buildRequests.at(-1)).toEqual({ platform: "ios", appId: "example_app", enabled: true });
  });

  it("starts the assessment of the version chosen and opens its progress", () => {
    render(application("ios"));
    const select = document.body.querySelector("select")!;
    act(() => {
      select.value = "3.9.9";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    act(() => button("Start assessment").click());

    expect(started).toEqual([{ applicationId: "app-id", buildVersion: "3.9.9" }]);
    expect(document.body.querySelector("[data-location]")?.getAttribute("data-location")).toBe(
      "/assessments?expanded=new-assessment-id",
    );
    expect(openState).toEqual([false]);
  });

  it("explains how to add a build when there is none, and cannot start", () => {
    builds = { isLoading: false, isError: false, data: { builds: [], default_version: null, ambiguous: false } };
    render(application("ios"));

    expect(text()).toContain("No build of this app is in the intake folder yet");
    expect(button("Start assessment").disabled).toBe(true);
  });

  it("refuses to guess between apps sharing a name", () => {
    builds = { ...builds, data: { ...builds.data!, ambiguous: true } };
    render(application("ios"));

    expect(text()).toContain("More than one app in the intake folder matches this one");
    expect(button("Start assessment").disabled).toBe(true);
  });

  it("says so when the backend cannot list builds", () => {
    builds = { isLoading: false, isError: false, data: null };
    render(application("ios"));

    expect(text()).toContain("could not list this app's builds");
    expect(button("Start assessment").disabled).toBe(true);
  });

  it("shows why the assessment could not start", () => {
    startError = Object.assign(new Error("this application already has an assessment in progress"), {
      userFacing: true,
    });
    render(application("ios"));

    expect(text()).toContain("this application already has an assessment in progress");
  });
});

describe("assessing a new Android version", () => {
  it("offers no version and tests what is installed", () => {
    render(application("android"));

    expect(document.body.querySelector("select")).toBeNull();
    expect(text()).toContain("Android tests the version installed on the test device");
    expect(buildRequests.at(-1)?.enabled).toBe(false);

    act(() => button("Start assessment").click());

    expect(started).toEqual([{ applicationId: "app-id", buildVersion: null }]);
  });
});
