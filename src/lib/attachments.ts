import { formatBytes } from "@/lib/utils";
import type { RiskConversationAttachment } from "@/data/types";

export type AttachmentSource =
  | { provider: "supabase"; path: string }
  | { provider: "server"; key: string };

/** Rows written before the provider column existed are Supabase objects. */
export function attachmentSource(attachment: RiskConversationAttachment): AttachmentSource {
  return attachment.storage_provider === "server"
    ? { provider: "server", key: attachment.storage_path }
    : { provider: "supabase", path: attachment.storage_path };
}

/** A storage key stays inside its own folder whatever the browser called the file. */
export function attachmentStorageKey(conversationId: string, fileName: string, now: number) {
  const safe =
    fileName
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".")
      .replace(/^\.+/, "") || "attachment";
  return `conversation-${conversationId}/${now}-${safe}`;
}

export function attachmentMeta(attachment: RiskConversationAttachment): string {
  const parts: string[] = [];
  if (typeof attachment.size_bytes === "number" && attachment.size_bytes >= 0) {
    parts.push(formatBytes(attachment.size_bytes));
  }
  if (attachment.mime_type) parts.push(attachment.mime_type);
  return parts.join(" · ");
}
