/**
 * Supabase operations for reading evidence rows and signing their storage files.
 */

import { supabase, EVIDENCE_BUCKET } from "@/database/client";
import type { Evidence } from "@/database/types";
import { createDebug } from "@/lib/debug";

const debug = createDebug("database:evidence");

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

  /** Creates a one-hour signed URL for an evidence file. */
  getSignedUrl(storagePath: string) {
    debug("signing evidence path", { storagePath });
    return supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, 3600);
  },
};
