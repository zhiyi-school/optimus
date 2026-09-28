/**
 * Supabase operations on uploaded evidence rows and their storage files.
 */

import { supabase, EVIDENCE_BUCKET } from "@/data/supabase";
import type { Evidence } from "@/data/types";
import { createDebug } from "@/lib/debug";
import { requireUserId } from "./common";

const debug = createDebug("data:evidence");

export const evidenceData = {
  /** Lists a finding's evidence, newest first. */
  async listForFinding(findingId: string): Promise<Evidence[]> {
    debug("listing evidence for finding", { findingId });
    const { data, error } = await supabase
      .from("evidence")
      .select("*")
      .eq("finding_id", findingId)
      .order("created_at", { ascending: false });
    if (error) {
      debug("listing evidence for finding failed", {
        findingId,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("listed evidence for finding", { findingId, count: data?.length });
    return data;
  },

  /** Lists a ticket's evidence, newest first. */
  async listForTicket(ticketId: string): Promise<Evidence[]> {
    debug("listing evidence for ticket", { ticketId });
    const { data, error } = await supabase
      .from("evidence")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false });
    if (error) {
      debug("listing evidence for ticket failed", {
        ticketId,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("listed evidence for ticket", { ticketId, count: data?.length });
    return data;
  },

  /** Uploads a file to the evidence bucket, then records its evidence row against the finding or ticket. */
  async uploadFile(findingId: string | null, ticketId: string | null, file: File) {
    debug("uploading evidence file", {
      findingId,
      ticketId,
      fileName: file.name,
      size: file.size,
      type: file.type,
    });
    const userId = await requireUserId();
    const prefix = findingId ? `finding-${findingId}` : `ticket-${ticketId}`;
    const storagePath = `${prefix}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(storagePath, file);
    if (uploadError) {
      debug("evidence upload failed", { storagePath, message: uploadError.message });
      throw uploadError;
    }
    debug("uploaded evidence bytes", { storagePath });

    const { data, error } = await supabase
      .from("evidence")
      .insert({
        finding_id: findingId,
        ticket_id: ticketId,
        type: file.type.startsWith("image/") ? "image" : "file",
        name: file.name,
        source: "dashboard",
        storage_path: storagePath,
        created_by: userId,
      })
      .select()
      .single();
    if (error) {
      debug("recording evidence row failed", { storagePath, code: error.code, message: error.message });
      throw error;
    }
    debug("recorded evidence row", { evidenceId: data?.id, storagePath });
    return data;
  },

  /** Creates a one-hour signed URL for an evidence file. */
  getSignedUrl(storagePath: string) {
    debug("signing evidence path", { storagePath });
    return supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, 3600);
  },
};
