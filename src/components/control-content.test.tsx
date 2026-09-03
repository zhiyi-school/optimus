// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ControlIntro,
  ControlReferences,
  ControlSourceArchive,
  ControlSteps,
  type ControlStepProgress,
} from "@/components/control-content";
import type { ControlDetail, ControlSourceMetadata } from "@/api/playbook-types";
import type { TicketControlStep } from "@/data/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONTROL_ID = "example-feature-01-risk-01-control-01";

function definition(overrides: Partial<ControlDetail> = {}): ControlDetail {
  return {
    control_id: CONTROL_ID,
    risk_id: "example-feature-01-risk-01",
    platform: "ios",
    title: "Control 1",
    status: "active",
    required: true,
    step_count: 2,
    playbook_revision: "sha256:aaa",
    has_source_archive: false,
    summary: "Example control summary.",
    source_file: `${CONTROL_ID}.md`,
    status_source: "default",
    intro: [{ type: "paragraph", text: "Read this before you start." }],
    steps: [
      {
        step_key: "rotate-example-key",
        step_id_source: "declared",
        content_hash: "sha256:one",
        step_index: 0,
        number: 1,
        step_title: "Pin the certificate",
        text: "Pin the certificate.",
        content: [
          {
            type: "image",
            path: "screenshots/example.png",
            alt: "Example screenshot",
            caption: "Example caption",
            url: `/platforms/ios/controls/${CONTROL_ID}/assets/screenshots/example.png`,
            exists: true,
          },
        ],
      },
      {
        step_key: "revoke-example-key",
        step_id_source: "declared",
        content_hash: "sha256:two",
        step_index: 1,
        number: 2,
        step_title: "Verify the pin",
        text: "Verify the pin.",
        content: [],
      },
    ],
    references: [{ label: "Example reference", url: "https://example.test/reference" }],
    source_archives: [],
    source_download_url: null,
    ...overrides,
  };
}

function stepRow(stepKey: string, overrides: Partial<TicketControlStep> = {}) {
  return {
    id: `tc-1-${stepKey}`,
    ticket_control_id: "tc-1",
    step_key: stepKey,
    status: "not_started",
    completed_at: null,
    completed_by: null,
    developer_note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as TicketControlStep;
}

function workMode(overrides: Partial<ControlStepProgress> = {}): ControlStepProgress {
  return {
    byStepKey: new Map([
      ["rotate-example-key", stepRow("rotate-example-key")],
      ["revoke-example-key", stepRow("revoke-example-key")],
    ]),
    editable: true,
    pending: false,
    error: null,
    setStatus: () => {},
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactNode) {
  act(() => root.render(node));
}

function toggles() {
  return [...container.querySelectorAll("button")].filter((b) => b.hasAttribute("aria-pressed"));
}

describe("preview mode", () => {
  it("renders every step of the control", () => {
    render(<ControlSteps control={definition()} />);

    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).toContain("Pin the certificate");
    expect(container.textContent).toContain("Verify the pin");
  });

  it("renders the screenshots that come with a step", () => {
    render(<ControlSteps control={definition()} />);

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toContain(`/controls/${CONTROL_ID}/assets/`);
    expect(container.textContent).toContain("Example caption");
  });

  it("renders the control's introduction", () => {
    render(<ControlIntro control={definition()} />);
    expect(container.textContent).toContain("Read this before you start.");
  });

  it("renders references as external links that cannot reach back into the app", () => {
    render(<ControlReferences control={definition()} />);

    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.test/reference");
    expect(anchor?.getAttribute("rel")).toContain("noopener");
  });

  it("cannot mark a step complete", () => {
    render(<ControlSteps control={definition()} />);

    expect(toggles()).toHaveLength(2);
    for (const toggle of toggles()) expect(toggle.disabled).toBe(true);
  });

  it("offers no note field, so nothing can be written against a step", () => {
    render(<ControlSteps control={definition()} />);

    expect(container.textContent).not.toContain("Add a note");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("explains itself when the control document lists no steps", () => {
    render(<ControlSteps control={definition({ steps: [] })} />);
    expect(container.textContent).toContain("no remediation steps yet");
  });

  it("reaches for no mutation, so reading a control writes no progress rows", () => {
    const page = readFileSync("src/pages/ControlPreview.tsx", "utf8");
    for (const mutation of [
      "useInitializeTicketControls",
      "useSetControlStepStatus",
      "useSetControlStatus",
      "controlProgressData",
      "useTicketControls",
      "useTicketControlSteps",
    ]) {
      expect(page, mutation).not.toContain(mutation);
    }
  });
});

describe("work mode", () => {
  it("lets a developer mark a step complete", () => {
    const setStatus = vi.fn();
    render(<ControlSteps control={definition()} progress={workMode({ setStatus })} />);

    const [first] = toggles();
    expect(first.disabled).toBe(false);
    act(() => first.click());

    expect(setStatus).toHaveBeenCalledWith("tc-1-rotate-example-key", "completed");
  });

  it("lets a developer undo a completed step", () => {
    const setStatus = vi.fn();
    render(
      <ControlSteps
        control={definition()}
        progress={workMode({
          setStatus,
          byStepKey: new Map([
            ["rotate-example-key", stepRow("rotate-example-key", { status: "completed" })],
          ]),
        })}
      />,
    );

    act(() => toggles()[0].click());
    expect(setStatus).toHaveBeenCalledWith("tc-1-rotate-example-key", "not_started");
  });

  it("offers a note only where there is a progress row to attach it to", () => {
    render(
      <ControlSteps
        control={definition()}
        progress={workMode({ byStepKey: new Map([["rotate-example-key", stepRow("rotate-example-key")]]) })}
      />,
    );

    expect([...container.querySelectorAll("button")].filter((b) => b.textContent === "Add a note"))
      .toHaveLength(1);
  });

  it("keeps a viewer without the capability read-only even with progress loaded", () => {
    render(<ControlSteps control={definition()} progress={workMode({ editable: false })} />);

    for (const toggle of toggles()) expect(toggle.disabled).toBe(true);
    expect(container.textContent).not.toContain("Add a note");
  });

  it("surfaces a failed save instead of silently losing it", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ControlSteps
        control={definition()}
        progress={workMode({ error: new Error("Network unreachable") })}
      />,
    );

    expect(container.textContent).toContain("Could not save your progress.");
    consoleError.mockRestore();
  });

  it("asks the developer to re-read a completed step that changed under them", () => {
    render(
      <ControlSteps
        control={definition()}
        progress={workMode({
          byStepKey: new Map([
            ["rotate-example-key", stepRow("rotate-example-key", { status: "completed" })],
          ]),
          needsReview: new Set(["rotate-example-key"]),
        })}
      />,
    );

    expect(container.textContent).toContain("This step changed after you completed it");
  });

  it("shows the current step content, never an older version of it", () => {
    render(
      <ControlSteps
        control={definition({
          steps: [{ ...definition().steps[0], text: "The rewritten instruction." }],
        })}
        progress={workMode({ needsReview: new Set(["rotate-example-key"]) })}
      />,
    );

    expect(container.textContent).toContain("The rewritten instruction.");
    expect(container.textContent).not.toContain("Pin the certificate.");
  });

  it("says nothing about review when no step changed", () => {
    render(<ControlSteps control={definition()} progress={workMode()} />);
    expect(container.textContent).not.toContain("This step changed after you completed it");
  });

  it("says nothing about failure while the save is fine", () => {
    render(<ControlSteps control={definition()} progress={workMode()} />);
    expect(container.textContent).not.toContain("Could not save your progress.");
  });
});

describe("implementation example", () => {
  const source: ControlSourceMetadata = {
    control_id: CONTROL_ID,
    exists: true,
    download_enabled: true,
    file_name: "example-implementation.zip",
    size_bytes: 2048,
    sha256: "a".repeat(64),
    declared: [],
  };

  it("offers the archive as a download and says it is not the developer's own evidence", () => {
    render(<ControlSourceArchive platform="ios" controlId={CONTROL_ID} source={source} />);

    expect(container.querySelector("a")?.getAttribute("href")).toContain(
      `/controls/${CONTROL_ID}/source/download`,
    );
    expect(container.textContent).toContain("not evidence of your own fix");
    expect(container.textContent).toContain("2 KB");
  });

  it("names the archive without a link when the host disables downloads", () => {
    render(
      <ControlSourceArchive
        platform="ios"
        controlId={CONTROL_ID}
        source={{ ...source, download_enabled: false }}
      />,
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("downloads are disabled");
  });

  it("shows nothing when the control has no archive", () => {
    render(
      <ControlSourceArchive
        platform="ios"
        controlId={CONTROL_ID}
        source={{ ...source, exists: false }}
      />,
    );

    expect(container.textContent).toBe("");
  });

  it("shows nothing before the platform is known", () => {
    render(<ControlSourceArchive platform={undefined} controlId={CONTROL_ID} source={source} />);
    expect(container.textContent).toBe("");
  });
});

describe("screenshots inside a control step", () => {
  function image() {
    return container.querySelector("img")!;
  }

  it("caps how large a screenshot can get", () => {
    render(<ControlSteps control={definition()} />);

    expect(image().className).toContain("max-h-[32rem]");
    expect(image().className).toContain("max-w-[min(100%,42rem)]");
  });

  it("never stretches a small screenshot to the width of the card", () => {
    render(<ControlSteps control={definition()} />);

    expect(image().className).toContain("w-auto");
    expect(image().className).not.toContain("w-full");
    expect(image().closest("figure")?.className).toContain("w-fit");
  });

  it("keeps the aspect ratio rather than cropping", () => {
    render(<ControlSteps control={definition()} />);

    expect(image().className).toContain("object-contain");
    expect(image().className).toContain("h-auto");
    expect(image().className).not.toContain("object-cover");
  });

  it("cannot push the page sideways on a narrow screen", () => {
    render(<ControlSteps control={definition()} />);

    expect(image().className).toContain("max-w-[min(100%,42rem)]");
    expect(image().closest("figure")?.className).toContain("max-w-full");
  });

  it("uses the same treatment a manual test step does", () => {
    const manual = readFileSync("src/pages/ManualTestSteps.tsx", "utf8");
    expect(manual).toContain("PlaybookFigure");
    expect(manual).not.toContain("<img");
  });

  it("keeps a caption with its own image", () => {
    render(<ControlSteps control={definition()} />);

    const figure = image().closest("figure")!;
    expect(figure.querySelector("figcaption")?.textContent).toContain("Example caption");
  });

  it("spaces several screenshots apart", () => {
    const control = definition();
    control.steps[0].content = [
      ...control.steps[0].content,
      {
        type: "image",
        path: "screenshots/second.png",
        alt: "Second screenshot",
        caption: "Second caption",
        url: "/platforms/ios/controls/example/assets/screenshots/second.png",
        exists: true,
      },
    ];
    render(<ControlSteps control={control} />);

    const figures = container.querySelectorAll("figure");
    expect(figures).toHaveLength(2);
    expect(figures[0].parentElement?.className).toContain("space-y-3");
  });

  it("says so plainly when a screenshot is missing, instead of a broken image", () => {
    const control = definition();
    control.steps[0].content = [
      { type: "image", path: "gone.png", alt: undefined, caption: undefined, url: null, exists: false },
    ];
    render(<ControlSteps control={control} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Screenshot unavailable.");
  });

  it("leaves code blocks scrolling on their own", () => {
    const control = definition();
    control.steps[0].content = [{ type: "code", text: "example --flag", language: "bash" }];
    render(<ControlSteps control={control} />);

    expect(container.querySelector("pre")?.className).toContain("overflow-x-auto");
  });
});
