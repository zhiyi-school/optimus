import { supabase, ATTACHMENTS_BUCKET } from "@/data/supabase";
import { insertAttachmentWithCompatibility } from "@/data/compatibility/workflow";
import { attachmentStorageKey } from "@/lib/attachments";
import type { RiskConversationAttachment } from "@/data/types";
import { createDebug } from "@/lib/debug";
import { requireUserId } from "./common";

const debug = createDebug("data:attachments");

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
    debug("uploading attachment bytes", {
      conversationId: pending.conversationId,
      entryId: pending.entryId,
      storagePath: pending.storagePath,
      fileName: pending.file.name,
      size: pending.file.size,
    });
    const result = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(pending.storagePath, pending.file);
    if (result.error) {
      debug("attachment upload failed", {
        storagePath: pending.storagePath,
        message: result.error.message,
      });
      throw result.error;
    }
    debug("uploaded attachment bytes", { storagePath: pending.storagePath });
  },

  async findByStoragePath(storagePath: string): Promise<RiskConversationAttachment | null> {
    debug("finding attachment by storage path", { storagePath });
    const result = await supabase
      .from("risk_conversation_attachments")
      .select("*")
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (result.error) {
      debug("finding attachment failed", {
        storagePath,
        code: result.error.code,
        message: result.error.message,
      });
      throw result.error;
    }
    debug("attachment lookup", { storagePath, id: result.data?.id ?? null });
    return result.data;
  },

  async saveMetadata(
    pending: PendingConversationAttachment,
  ): Promise<RiskConversationAttachment> {
    debug("saving attachment metadata", { entryId: pending.entryId, storagePath: pending.storagePath });
    const existing = await conversationAttachmentData.findByStoragePath(pending.storagePath);
    if (existing) {
      debug("attachment metadata already recorded; reusing", { attachmentId: existing.id });
      return existing;
    }
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
      debug("attachment metadata insert failed; checking for concurrent write", {
        storagePath: pending.storagePath,
        code: (error as { code?: string } | null)?.code,
        message: (error as Error | null)?.message,
      });
      const written = await conversationAttachmentData.findByStoragePath(pending.storagePath);
      if (written) {
        debug("attachment metadata written concurrently; reusing", { attachmentId: written.id });
        return written;
      }
      throw error;
    }
  },

  async discardUnused(pending: PendingConversationAttachment): Promise<void> {
    debug("discarding unused attachment", { storagePath: pending.storagePath });
    const existing = await conversationAttachmentData.findByStoragePath(pending.storagePath);
    if (existing) {
      debug("attachment is recorded; keeping bytes", { attachmentId: existing.id });
      return;
    }
    const result = await supabase.storage.from(ATTACHMENTS_BUCKET).remove([pending.storagePath]);
    if (result.error) {
      debug("discarding attachment failed", {
        storagePath: pending.storagePath,
        message: result.error.message,
      });
      throw result.error;
    }
    debug("discarded attachment bytes", { storagePath: pending.storagePath });
  },

  getSignedUrl(storagePath: string) {
    debug("signing attachment path", { storagePath });
    return supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(storagePath, 3600);
  },
};
