/**
 * Supabase operations on findings, their history and risk classification.
 */

import { supabase } from "@/data/supabase";
import type { Application, Finding, FindingHistory, FindingStatus } from "@/data/types";
import { requireUserId } from "./common";
import { activityData } from "./activity";
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
  /** Lists findings matching the filters, newest first. */
  async list(filters: FindingFilters = {}): Promise<Finding[]> {
    debug("listing findings", filterSummary(filters));
    let query = supabase.from("findings").select("*");
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.applicationId)
      query = query.eq("application_id", filters.applicationId);
    if (filters.platform) query = query.eq("platform", filters.platform);
    if (filters.severity) query = query.eq("severity", filters.severity);
    if (filters.search) query = query.ilike("title", `%${filters.search}%`);
    const { data, error } = await query.order("created_at", {
      ascending: false,
    });
    if (error) {
      debug("listing findings failed", { code: error.code, message: error.message });
      throw error;
    }
    debug("listed findings", { count: data?.length });
    return data;
  },

  /** Fetches one finding, or null. */
  async get(id: string): Promise<Finding | null> {
    debug("fetching finding", { id });
    const { data, error } = await supabase
      .from("findings")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      debug("fetching finding failed", { id, code: error.code, message: error.message });
      throw error;
    }
    debug("fetched finding", { id, found: !!data, status: data?.status });
    return data;
  },

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

  /** Lists a finding's status history, newest first. */
  async history(findingId: string): Promise<FindingHistory[]> {
    debug("listing finding history", { findingId });
    const { data, error } = await supabase
      .from("finding_history")
      .select("*")
      .eq("finding_id", findingId)
      .order("created_at", { ascending: false });
    if (error) {
      debug("listing finding history failed", { findingId, code: error.code, message: error.message });
      throw error;
    }
    debug("listed finding history", { findingId, count: data?.length });
    return data;
  },

  /** Inserts or updates a finding keyed on its backend `external_id`. */
  async upsertByExternalId(
    finding: Partial<Finding> & { external_id: string },
  ): Promise<Finding> {
    debug("upserting finding by external id", {
      externalId: finding.external_id,
      fields: Object.keys(finding),
    });
    const { data, error } = await supabase
      .from("findings")
      .upsert(finding, { onConflict: "external_id" })
      .select()
      .single();
    if (error) {
      debug("upserting finding failed", {
        externalId: finding.external_id,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("upserted finding", { id: data?.id, externalId: finding.external_id });
    return data;
  },

  /** Updates a finding's status, then records history (best effort) and an activity entry. */
  async updateStatus(
    findingId: string,
    newStatus: FindingStatus,
    reason?: string,
  ): Promise<Finding> {
    debug("updating finding status", { findingId, newStatus, reasonLength: reason?.length ?? 0 });
    const current = await findingData.get(findingId);
    const userId = await requireUserId();

    const { data, error } = await supabase
      .from("findings")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", findingId)
      .select()
      .single();
    if (error) {
      debug("updating finding status failed", { findingId, code: error.code, message: error.message });
      throw error;
    }
    debug("updated finding status", { findingId, from: current?.status ?? null, to: newStatus });

    const historyResult = await supabase.from("finding_history").insert({
      finding_id: findingId,
      previous_status: current?.status ?? null,
      new_status: newStatus,
      changed_by: userId,
      reason: reason ?? null,
    });
    if (historyResult?.error) {
      debug("recording finding history failed; continuing", {
        findingId,
        code: historyResult.error.code,
        message: historyResult.error.message,
      });
    }

    await activityData.log({
      entity_type: "finding",
      entity_id: findingId,
      action: "finding_status_changed",
      metadata: { previous_status: current?.status, new_status: newStatus },
    });

    return data;
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
