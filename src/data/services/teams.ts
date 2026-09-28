import { supabase } from "@/data/supabase";
import type { Team } from "@/data/types";
import { createDebug } from "@/lib/debug";

const debug = createDebug("data:teams");

export const teamData = {
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
