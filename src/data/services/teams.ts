import { supabase } from "@/data/supabase";
import type { Team } from "@/data/types";

export const teamData = {
  async list(): Promise<Team[]> {
    const { data, error } = await supabase.from("teams").select("*").order("name");
    if (error) throw error;
    return data;
  },

  async create(team: { name: string; type: Team["type"] }): Promise<Team> {
    const { data, error } = await supabase.from("teams").insert(team).select().single();
    if (error) throw error;
    return data;
  },
};
