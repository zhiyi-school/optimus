import { supabase, ATTACHMENTS_BUCKET } from "@/data/supabase";
import { insertAttachmentWithCompatibility } from "@/data/compatibility/workflow";
import { attachmentStorageKey } from "@/lib/attachments";
import type { RiskConversationAttachment } from "@/data/types";
import { requireUserId } from "./common";

export interface PendingConversationAttachment {
  conversationId: string;
  entryId: string;
  file: File;
  storagePath: string;
}

export function createPendingConversationAttachment(
  conversationId: string,
  entryId: string,
  file: File,
): PendingConversationAttachment {
  return {
    conversationId,
    entryId,
    file,
    storagePath: attachmentStorageKey(conversationId, file.name, Date.now()),
  };
}

export const conversationAttachmentData = {
  async uploadBytes(pending: PendingConversationAttachment): Promise<void> {
    const result = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(pending.storagePath, pending.file);
    if (result.error) throw result.error;
  },

  async findByStoragePath(storagePath: string): Promise<RiskConversationAttachment | null> {
    const result = await supabase
      .from("risk_conversation_attachments")
      .select("*")
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  },

  async saveMetadata(
    pending: PendingConversationAttachment,
  ): Promise<RiskConversationAttachment> {
    const existing = await conversationAttachmentData.findByStoragePath(pending.storagePath);
    if (existing) return existing;
    const userId = await requireUserId();
    const row = {
      entry_id: pending.entryId,
      uploaded_by: userId,
      storage_path: pending.storagePath,
      file_name: pending.file.name,
      mime_type: pending.file.type || null,
      storage_provider: "supabase" as const,
      size_bytes: pending.file.size,
    };
    try {
      return (await insertAttachmentWithCompatibility(row)).attachment;
    } catch (error) {
      const written = await conversationAttachmentData.findByStoragePath(pending.storagePath);
      if (written) return written;
      throw error;
    }
  },

  async discardUnused(pending: PendingConversationAttachment): Promise<void> {
    const existing = await conversationAttachmentData.findByStoragePath(pending.storagePath);
    if (existing) return;
    const result = await supabase.storage.from(ATTACHMENTS_BUCKET).remove([pending.storagePath]);
    if (result.error) throw result.error;
  },

  getSignedUrl(storagePath: string) {
    return supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(storagePath, 3600);
  },
};
