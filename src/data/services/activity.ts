/**
 * Supabase writes to the activity log.
 */

import { supabase } from "@/data/supabase";
import { createDebug } from "@/lib/debug";
import { requireUserId } from "./common";

const debug = createDebug("data:activity");

export const activityData = {
  /** Records an activity entry, attributed to the signed-in user when there is one. */
  async log(entry: {
    entity_type: string;
    entity_id: string;
    action: string;
    metadata?: Record<string, unknown>;
  }) {
    debug("logging activity", {
      entityType: entry.entity_type,
      entityId: entry.entity_id,
      action: entry.action,
      metadataKeys: entry.metadata ? Object.keys(entry.metadata) : [],
    });
    const actor_id = await requireUserId().catch((err) => {
      debug("no actor for activity; logging anonymously", { message: err?.message });
      return null;
    });
    const { error } = await supabase.from("activity_log").insert({
      actor_id,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      action: entry.action,
      metadata: entry.metadata ?? null,
    });
    if (error) {
      debug("logging activity failed", { action: entry.action, code: error.code, message: error.message });
      throw error;
    }
    debug("logged activity", { action: entry.action, entityId: entry.entity_id });
  },
};
