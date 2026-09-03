import { useMemo, useState, type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { automationAssetUrl } from "@/api/automation-client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { PlaybookBlock, PlaybookTableBlock } from "@/api/playbook-types";
import { renderInline } from "@/lib/inline-markdown";
import { renderableBlocks } from "@/lib/playbook";

/** Phone screenshots stay thumbnail-sized; diagrams and desktop captures get the wider cap. */
const figureSize = {
  compact: "h-auto max-h-[15rem] w-auto max-w-[min(100%,13rem)] object-contain",
  wide: "h-auto max-h-[26rem] w-auto max-w-[min(100%,40rem)] object-contain",
};

/**
 * The one screenshot treatment, shared by playbook blocks and manual test
 * steps: never upscaled past its own size, capped small enough to sit beside
 * its siblings, and expandable to full size on click.
 */
export function PlaybookFigure({
  url,
  caption,
  alt,
  exists,
  unavailableLabel = "Screenshot unavailable.",
  size = "compact",
}: {
  url: string | null | undefined;
  caption?: string | null;
  alt?: string | null;
  exists?: boolean;
  unavailableLabel?: string;
  size?: keyof typeof figureSize;
}) {
  const [expanded, setExpanded] = useState(false);

  if (exists === false || !url) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        {caption ? `${caption} — screenshot unavailable.` : unavailableLabel}
      </div>
    );
  }

  const src = automationAssetUrl(url);
  const label = caption || alt || "Screenshot";

  return (
    <figure className="w-fit max-w-full overflow-hidden rounded-md border border-border">
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`View ${label} at full size`}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        <img src={src} alt={label} className={figureSize[size]} loading="lazy" />
      </button>
      {caption && (
        <figcaption className="border-t border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {renderInline(caption)}
        </figcaption>
      )}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="mb-3 pr-6 text-sm">{label}</DialogTitle>
          <img src={src} alt={label} className="mx-auto max-h-[75vh] w-auto max-w-full object-contain" />
        </DialogContent>
      </Dialog>
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
      return (
        <PlaybookFigure
          url={block.url}
          caption={block.caption}
          alt={block.alt}
          exists={block.exists}
          unavailableLabel="Screenshot unavailable."
        />
      );
    default:
      return null;
  }
}

/** Neighbouring screenshots read as one illustration, so they lay out as a row rather than a stack. */
export function PlaybookGallery({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-3">{children}</div>;
}

export function PlaybookContent({
  blocks,
  className = "space-y-3",
}: {
  blocks: PlaybookBlock[] | undefined;
  className?: string;
}) {
  const renderable = renderableBlocks(blocks);
  const groups = groupImages(renderable);
  if (renderable.length === 0) return null;
  return (
    <div className={className}>
      {groups.map((group, index) =>
        Array.isArray(group) ? (
          <PlaybookGallery key={index}>
            {group.map((block, imageIndex) => (
              <PlaybookBlockView key={imageIndex} block={block} />
            ))}
          </PlaybookGallery>
        ) : (
          <PlaybookBlockView key={index} block={group} />
        ),
      )}
    </div>
  );
}

function groupImages(blocks: PlaybookBlock[]): (PlaybookBlock | PlaybookBlock[])[] {
  const groups: (PlaybookBlock | PlaybookBlock[])[] = [];
  for (const block of blocks) {
    const previous = groups[groups.length - 1];
    if (block.type !== "image") {
      groups.push(block);
    } else if (Array.isArray(previous)) {
      previous.push(block);
    } else {
      groups.push([block]);
    }
  }
  return groups;
}
