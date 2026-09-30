/**
 * Supabase operations on teams.
 */

import { supabase } from "@/database/client";
import type { Team } from "@/database/types";
import { createDebug } from "@/lib/debug";

const debug = createDebug("database:teams");

export const teamData = {
  /** Lists every team by name. */
  async list(): Promise<Team[]> {
    debug("listing teams");
    const { data, error } = await supabase.from("teams").select("*").order("name");
    if (error) {
      debug("listing teams failed", { code: error.code, message: error.message });
      throw error;
    }
    debug("listed teams", { count: data?.length });
    return data;
  },

  /** Creates a team and returns the stored row. */
  async create(team: { name: string; type: Team["type"] }): Promise<Team> {
    debug("creating team", { type: team.type });
    const { data, error } = await supabase.from("teams").insert(team).select().single();
    if (error) {
      debug("creating team failed", { type: team.type, code: error.code, message: error.message });
      throw error;
    }
    debug("created team", { teamId: data?.id });
    return data;
  },
};
