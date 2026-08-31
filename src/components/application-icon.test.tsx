// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationIcon } from "@/components/application-icon";
import type { Application } from "@/data/types";

const withIcon = {
  external_id: "example_app",
  platform: "ios",
  name: "Example App",
  app_type: "Banking",
  icon_ref: "icons/" + "b".repeat(64) + ".png",
  icon_extraction_status: "available",
} as Application;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function render(application: Application | null) {
  act(() => root.render(<ApplicationIcon application={application} />));
}

describe("ApplicationIcon", () => {
  it("renders the backend icon when one is available", () => {
    render(withIcon);

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toContain("/config/ios/apps/example_app/icon");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("falls back to the placeholder when the image fails to load", () => {
    render(withIcon);
    const image = container.querySelector("img") as HTMLImageElement;

    act(() => image.dispatchEvent(new Event("error", { bubbles: false })));

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the placeholder for an application whose icon the backend cannot produce", () => {
    render({ ...withIcon, icon_ref: null, icon_extraction_status: "unavailable" } as Application);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the placeholder for an application row that predates icon support", () => {
    render({
      ...withIcon,
      icon_ref: null,
      icon_extraction_status: null,
      artifact_sha256: null,
    } as Application);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the placeholder when there is no application at all", () => {
    render(null);

    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("retries after the application starts pointing at a different icon", () => {
    render(withIcon);
    const image = container.querySelector("img") as HTMLImageElement;
    act(() => image.dispatchEvent(new Event("error", { bubbles: false })));
    expect(container.querySelector("img")).toBeNull();

    render({ ...withIcon, external_id: "other_app" } as Application);

    expect(container.querySelector("img")).not.toBeNull();
  });

  it("never renders image data or a storage path into the document", () => {
    render(withIcon);

    expect(container.innerHTML).not.toContain("data:image");
    expect(container.innerHTML).not.toContain("icons/");
  });
});
