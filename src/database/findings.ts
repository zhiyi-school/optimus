/**
 * Supabase operations on findings, their history and risk classification.
 */

import { supabase } from "@/database/client";
import type { Application, Finding, FindingStatus } from "@/database/types";
import { createDebug } from "@/lib/debug";

const debug = createDebug("data:findings");

/** Finding filters for debug logs, with the search text reduced to its length. */
function filterSummary(filters: FindingFilters) {
  return { ...filters, search: filters.search?.length };
}

export interface FindingFilters {
  status?: FindingStatus;
  applicationId?: string;
  platform?: string;
  severity?: string;
  search?: string;
}

export const findingData = {
  /** Lists filtered findings with their application joined, newest first. */
  async listWithApplication(
    filters: FindingFilters = {},
  ): Promise<(Finding & { application: Application | null })[]> {
    debug("listing findings with applications", filterSummary(filters));
    let query = supabase.from("findings").select("*, application:applications(*)");
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.applicationId)
      query = query.eq("application_id", filters.applicationId);
    if (filters.platform) query = query.eq("platform", filters.platform);
    if (filters.severity) query = query.eq("severity", filters.severity);
    if (filters.search) query = query.ilike("title", `%${filters.search}%`);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      debug("listing findings with applications failed", {
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("listed findings with applications", { count: data?.length });
    return data as (Finding & { application: Application | null })[];
  },

  /** Fetches one finding with its application joined, or null. */
  async getWithApplication(
    id: string,
  ): Promise<(Finding & { application: Application | null }) | null> {
    debug("fetching finding with application", { id });
    const { data, error } = await supabase
      .from("findings")
      .select("*, application:applications(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      debug("fetching finding with application failed", {
        id,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("fetched finding with application", { id, found: !!data });
    return data as (Finding & { application: Application | null }) | null;
  },




  /** Sets a finding's classification with a required reason; one RPC writes status, history and event together. */
  async classify(input: {
    findingId: string;
    conversationId: string;
    status: FindingStatus;
    reason: string;
  }): Promise<{ finding: Finding; entryId: string }> {
    const trimmed = input.reason.trim();
    debug("classifying finding", {
      findingId: input.findingId,
      conversationId: input.conversationId,
      status: input.status,
      reasonLength: trimmed.length,
    });
    if (!trimmed) {
      debug("classification refused; empty reason", { findingId: input.findingId });
      throw new Error("Changing the risk classification needs a reason.");
    }
    const { data, error } = await supabase.rpc("classify_risk_entry", {
      p_finding_id: input.findingId,
      p_conversation_id: input.conversationId,
      p_status: input.status,
      p_reason: trimmed,
    });
    if (error) {
      debug("rpc classify_risk_entry failed", { code: error.code, message: error.message });
      throw error;
    }
    const payload = data as { finding: Finding; entry_id: string };
    debug("classified finding", { findingId: input.findingId, entryId: payload.entry_id });
    return { finding: payload.finding, entryId: payload.entry_id };
  },
};
