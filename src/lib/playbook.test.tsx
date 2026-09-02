import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type { PlaybookBlock } from "@/api/playbook-types";
import { renderInline } from "./inline-markdown";
import { RENDERABLE_BLOCKS, isRenderable, renderableBlocks } from "./playbook";

function anchors(node: unknown, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) anchors(child, found);
    return found;
  }
  if (isValidElement(node)) {
    if (node.type === "a") found.push(node);
    anchors((node.props as { children?: unknown }).children, found);
  }
  return found;
}

describe("block allowlist", () => {
  it("accepts every block kind the backend catalogue emits", () => {
    for (const type of RENDERABLE_BLOCKS) {
      expect(isRenderable({ type } as PlaybookBlock), type).toBe(true);
    }
  });

  it("drops a block kind the dashboard does not know how to render", () => {
    expect(isRenderable({ type: "html" } as unknown as PlaybookBlock)).toBe(false);
    expect(isRenderable({ type: "script" } as unknown as PlaybookBlock)).toBe(false);
    expect(isRenderable({ type: "iframe" } as unknown as PlaybookBlock)).toBe(false);
  });

  it("drops anything that is not a block at all", () => {
    expect(isRenderable(null)).toBe(false);
    expect(isRenderable(undefined)).toBe(false);
    expect(isRenderable("paragraph" as unknown as PlaybookBlock)).toBe(false);
    expect(isRenderable({} as PlaybookBlock)).toBe(false);
  });

  it("filters a mixed list down to the renderable blocks", () => {
    const blocks = [
      { type: "paragraph", text: "kept" },
      { type: "html", text: "<script>alert(1)</script>" },
      { type: "code", language: null, text: "kept" },
    ] as unknown as PlaybookBlock[];
    expect(renderableBlocks(blocks).map((block) => block.type)).toEqual(["paragraph", "code"]);
  });

  it("handles a missing block list", () => {
    expect(renderableBlocks(undefined)).toEqual([]);
  });
});

describe("inline markdown safety", () => {
  it("renders an http link the playbook actually contains", () => {
    const links = anchors(renderInline("See [the docs](https://example.test/guide)"));
    expect(links).toHaveLength(1);
    expect(links[0].props).toMatchObject({
      href: "https://example.test/guide",
      rel: "noreferrer noopener",
    });
  });

  it("never produces a javascript: link", () => {
    expect(anchors(renderInline("[click](javascript:alert(1))"))).toHaveLength(0);
    expect(anchors(renderInline("[click](JaVaScRiPt:alert(1))"))).toHaveLength(0);
  });

  it("never produces a data: link", () => {
    expect(anchors(renderInline("[click](data:text/html,<script>alert(1)</script>)"))).toHaveLength(0);
  });

  it("does not turn raw HTML into markup", () => {
    const rendered = renderInline("<img src=x onerror=alert(1)>");
    expect(anchors(rendered)).toHaveLength(0);
    expect(typeof rendered === "string" ? rendered : "").toContain("<img");
  });

  it("renders nothing for empty text", () => {
    expect(renderInline("")).toBeNull();
    expect(renderInline(undefined)).toBeNull();
  });
});
