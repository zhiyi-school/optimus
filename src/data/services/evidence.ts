import { supabase, EVIDENCE_BUCKET } from "@/data/supabase";
import type { Evidence } from "@/data/types";
import { requireUserId } from "./common";

export const evidenceData = {
  async listForFinding(findingId: string): Promise<Evidence[]> {
    const { data, error } = await supabase
      .from("evidence")
      .select("*")
      .eq("finding_id", findingId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async uploadFile(findingId: string | null, ticketId: string | null, file: File) {
    const userId = await requireUserId();
    const prefix = findingId ? `finding-${findingId}` : `ticket-${ticketId}`;
    const storagePath = `${prefix}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(storagePath, file);
    if (uploadError) throw uploadError;

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
    if (error) throw error;
    return data;
  },

  getSignedUrl(storagePath: string) {
    return supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, 3600);
  },
};
