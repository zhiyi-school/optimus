/**
 * Storage location, key and metadata helpers for conversation attachments.
 */

import { formatBytes } from "@/lib/utils";
import type { RiskConversationAttachment } from "@/database/types";

export type AttachmentSource =
  | { provider: "supabase"; path: string }
  | { provider: "server"; key: string };

/** Where an attachment's bytes live; rows predating the provider column are Supabase objects. */
export function attachmentSource(attachment: RiskConversationAttachment): AttachmentSource {
  return attachment.storage_provider === "server"
    ? { provider: "server", key: attachment.storage_path }
    : { provider: "supabase", path: attachment.storage_path };
}

/** Builds a sanitised storage key that stays in the conversation's folder whatever the file is called. */
export function attachmentStorageKey(conversationId: string, fileName: string, now: number) {
  const safe =
    fileName
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".")
      .replace(/^\.+/, "") || "attachment";
  return `conversation-${conversationId}/${now}-${safe}`;
}

/** A "size · MIME type" summary line for an attachment. */
export function attachmentMeta(attachment: RiskConversationAttachment): string {
  const parts: string[] = [];
  if (typeof attachment.size_bytes === "number" && attachment.size_bytes >= 0) {
    parts.push(formatBytes(attachment.size_bytes));
  }
  if (attachment.mime_type) parts.push(attachment.mime_type);
  return parts.join(" · ");
}
