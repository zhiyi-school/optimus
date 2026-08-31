import { supabase } from "@/data/supabase";
import type { ActivityLogEntry } from "@/data/types";
import { requireUserId } from "./common";

export const activityData = {
  async log(entry: {
    entity_type: string;
    entity_id: string;
    action: string;
    metadata?: Record<string, unknown>;
  }) {
    const actor_id = await requireUserId().catch(() => null);
    const { error } = await supabase.from("activity_log").insert({
      actor_id,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      action: entry.action,
      metadata: entry.metadata ?? null,
    });
    if (error) throw error;
  },

  async listForEntity(
    entityType: string,
    entityId: string,
  ): Promise<ActivityLogEntry[]> {
    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },
};
