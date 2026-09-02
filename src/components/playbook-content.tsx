import { useMemo } from "react";
import { ImageOff } from "lucide-react";
import { automationAssetUrl } from "@/api/automation-client";
import type { PlaybookBlock, PlaybookImageBlock, PlaybookTableBlock } from "@/api/playbook-types";
import { renderInline } from "@/lib/inline-markdown";
import { renderableBlocks } from "@/lib/playbook";

function PlaybookImage({ block }: { block: PlaybookImageBlock }) {
  const label = block.caption || block.alt || "Playbook screenshot";
  if (!block.exists || !block.url) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        {block.caption ? `${block.caption} — screenshot unavailable.` : "Screenshot unavailable."}
      </div>
    );
  }
  return (
    <figure className="overflow-hidden rounded-lg border border-border">
      <img src={automationAssetUrl(block.url)} alt={label} className="w-full" loading="lazy" />
      {block.caption && (
        <figcaption className="border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {renderInline(block.caption)}
        </figcaption>
      )}
    </figure>
  );
}

function PlaybookTable({ block }: { block: PlaybookTableBlock }) {
  const columns = useMemo(
    () => (block.columns?.length ? block.columns : Object.keys(block.rows?.[0] ?? {})),
    [block.columns, block.rows],
  );
  if (!block.rows?.length) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 text-left text-xs font-semibold text-foreground">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {block.rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column} className="px-3 py-2 align-top text-muted-foreground">
                  {renderInline(row[column]) ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlaybookBlockView({ block }: { block: PlaybookBlock }) {
  switch (block.type) {
    case "heading":
      return <p className="text-sm font-semibold text-foreground">{renderInline(block.text)}</p>;
    case "paragraph":
      return <p className="text-sm text-foreground">{renderInline(block.text)}</p>;
    case "caption":
      return <p className="text-xs italic text-muted-foreground">{renderInline(block.text)}</p>;
    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
          <code>{block.text}</code>
        </pre>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag
          className={
            block.ordered
              ? "list-decimal space-y-1 pl-5 text-sm text-foreground"
              : "list-disc space-y-1 pl-5 text-sm text-foreground"
          }
        >
          {(block.items ?? []).map((item, index) => (
            <li key={index}>{renderInline(item.text)}</li>
          ))}
        </ListTag>
      );
    }
    case "table":
      return <PlaybookTable block={block} />;
    case "image":
      return <PlaybookImage block={block} />;
    default:
      return null;
  }
}

export function PlaybookContent({
  blocks,
  className = "space-y-3",
}: {
  blocks: PlaybookBlock[] | undefined;
  className?: string;
}) {
  const renderable = renderableBlocks(blocks);
  if (renderable.length === 0) return null;
  return (
    <div className={className}>
      {renderable.map((block, index) => (
        <PlaybookBlockView key={index} block={block} />
      ))}
    </div>
  );
}
