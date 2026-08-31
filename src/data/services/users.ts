import { supabase } from "@/data/supabase";
import type { Profile } from "@/data/types";
import { requireUserId } from "./common";

export const userData = {
  async getCurrentProfile(): Promise<Profile | null> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listProfiles(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("display_name");
    if (error) throw error;
    return data;
  },

  async updateTeam(profileId: string, teamId: string | null): Promise<Profile> {
    const { data, error } = await supabase
      .from("profiles")
      .update({ team_id: teamId })
      .eq("id", profileId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async setActive(profileId: string, isActive: boolean): Promise<Profile> {
    const { data, error } = await supabase
      .from("profiles")
      .update({ is_active: isActive })
      .eq("id", profileId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Admin-only; the database also refuses a user changing their own roles. */
  async updateRoles(profileId: string, roles: Profile["roles"]): Promise<Profile> {
    const { data, error } = await supabase
      .from("profiles")
      .update({ roles })
      .eq("id", profileId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
