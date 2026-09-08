import { Download, Paperclip } from "lucide-react";
import { useAttachmentDownload } from "@/hooks/attachments";
import { attachmentMeta } from "@/lib/attachments";
import type { RiskConversationAttachment } from "@/data/types";

export function AttachmentList({ attachments }: { attachments: RiskConversationAttachment[] }) {
  const { busy, failed, start } = useAttachmentDownload();
  if (attachments.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1">
      {attachments.map((attachment) => {
        const meta = attachmentMeta(attachment);
        const downloading = busy === attachment.id;
        return (
          <li key={attachment.id} className="text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-all text-foreground">{attachment.file_name}</span>
              {meta && <span className="text-muted-foreground">{meta}</span>}
              <button
                type="button"
                disabled={downloading}
                onClick={() => void start(attachment)}
                aria-label={`Download ${attachment.file_name}`}
                className="inline-flex shrink-0 items-center gap-1 rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-progress disabled:opacity-60"
              >
                <Download className="h-3 w-3" />
                {downloading ? "Downloading…" : "Download"}
              </button>
            </div>
            {failed?.id === attachment.id && (
              <p className="mt-1 text-danger">
                {failed.message}{" "}
                <button
                  type="button"
                  onClick={() => void start(attachment)}
                  className="font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Try again
                </button>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
