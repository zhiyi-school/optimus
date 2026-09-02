import type { PlaybookBlock } from "@/api/playbook-types";

export const RENDERABLE_BLOCKS = [
  "heading",
  "paragraph",
  "caption",
  "code",
  "list",
  "table",
  "image",
] as const;

const allowed = new Set<string>(RENDERABLE_BLOCKS);

export function isRenderable(block: PlaybookBlock | undefined | null): boolean {
  if (!block || typeof block !== "object") return false;
  return allowed.has((block as { type?: unknown }).type as string);
}

export function renderableBlocks(blocks: PlaybookBlock[] | undefined): PlaybookBlock[] {
  return (blocks ?? []).filter(isRenderable);
}
