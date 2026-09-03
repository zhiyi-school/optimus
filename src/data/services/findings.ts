import { supabase } from "@/data/supabase";
import type { Application, Finding, FindingHistory, FindingStatus } from "@/data/types";
import { requireUserId } from "./common";
import { activityData } from "./activity";

export interface FindingFilters {
  status?: FindingStatus;
  applicationId?: string;
  platform?: string;
  severity?: string;
  search?: string;
}

export const findingData = {
  async list(filters: FindingFilters = {}): Promise<Finding[]> {
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
    if (error) throw error;
    return data;
  },

  async get(id: string): Promise<Finding | null> {
    const { data, error } = await supabase
      .from("findings")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listWithApplication(
    filters: FindingFilters = {},
  ): Promise<(Finding & { application: Application | null })[]> {
    let query = supabase.from("findings").select("*, application:applications(*)");
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.applicationId)
      query = query.eq("application_id", filters.applicationId);
    if (filters.platform) query = query.eq("platform", filters.platform);
    if (filters.severity) query = query.eq("severity", filters.severity);
    if (filters.search) query = query.ilike("title", `%${filters.search}%`);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    return data as (Finding & { application: Application | null })[];
  },

  async getWithApplication(
    id: string,
  ): Promise<(Finding & { application: Application | null }) | null> {
    const { data, error } = await supabase
      .from("findings")
      .select("*, application:applications(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data as (Finding & { application: Application | null }) | null;
  },

  async history(findingId: string): Promise<FindingHistory[]> {
    const { data, error } = await supabase
      .from("finding_history")
      .select("*")
      .eq("finding_id", findingId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async upsertByExternalId(
    finding: Partial<Finding> & { external_id: string },
  ): Promise<Finding> {
    const { data, error } = await supabase
      .from("findings")
      .upsert(finding, { onConflict: "external_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateStatus(
    findingId: string,
    newStatus: FindingStatus,
    reason?: string,
  ): Promise<Finding> {
    const current = await findingData.get(findingId);
    const userId = await requireUserId();

    const { data, error } = await supabase
      .from("findings")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", findingId)
      .select()
      .single();
    if (error) throw error;

    await supabase.from("finding_history").insert({
      finding_id: findingId,
      previous_status: current?.status ?? null,
      new_status: newStatus,
      changed_by: userId,
      reason: reason ?? null,
    });

    await activityData.log({
      entity_type: "finding",
      entity_id: findingId,
      action: "finding_status_changed",
      metadata: { previous_status: current?.status, new_status: newStatus },
    });

    return data;
  },

  /**
   * The risk classification is the finding's status. One database function
   * writes the status, its history row and the conversation event together, so
   * the decision can never land without the record of who made it and why. It
   * also refuses a finding that belongs to a different application risk than
   * the conversation it was requested from.
   */
  async classify(input: {
    findingId: string;
    conversationId: string;
    status: FindingStatus;
    reason: string;
  }): Promise<Finding> {
    const trimmed = input.reason.trim();
    if (!trimmed) throw new Error("Changing the risk classification needs a reason.");
    const { data, error } = await supabase.rpc("classify_risk", {
      p_finding_id: input.findingId,
      p_conversation_id: input.conversationId,
      p_status: input.status,
      p_reason: trimmed,
    });
    if (error) throw error;
    return data as Finding;
  },
};
