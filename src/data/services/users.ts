import { supabase } from "@/data/supabase";
import type { Profile } from "@/data/types";
import { createDebug } from "@/lib/debug";
import { requireUserId } from "./common";

const debug = createDebug("data:users");

export const userData = {
  async getCurrentProfile(): Promise<Profile | null> {
    const userId = await requireUserId();
    debug("fetching current profile", { userId });
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      debug("fetching current profile failed", { userId, code: error.code, message: error.message });
      throw error;
    }
    debug("fetched current profile", { userId, found: !!data, roles: data?.roles });
    return data;
  },

  async listProfiles(): Promise<Profile[]> {
    debug("listing profiles");
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("display_name");
    if (error) {
      debug("listing profiles failed", { code: error.code, message: error.message });
      throw error;
    }
    debug("listed profiles", { count: data?.length });
    return data;
  },

  async updateTeam(profileId: string, teamId: string | null): Promise<Profile> {
    debug("updating profile team", { profileId, teamId });
    const { data, error } = await supabase
      .from("profiles")
      .update({ team_id: teamId })
      .eq("id", profileId)
      .select()
      .single();
    if (error) {
      debug("updating profile team failed", { profileId, code: error.code, message: error.message });
      throw error;
    }
    debug("updated profile team", { profileId, teamId: data?.team_id });
    return data;
  },

  async setActive(profileId: string, isActive: boolean): Promise<Profile> {
    debug("setting profile active state", { profileId, isActive });
    const { data, error } = await supabase
      .from("profiles")
      .update({ is_active: isActive })
      .eq("id", profileId)
      .select()
      .single();
    if (error) {
      debug("setting profile active state failed", {
        profileId,
        code: error.code,
        message: error.message,
      });
      throw error;
    }
    debug("set profile active state", { profileId, isActive: data?.is_active });
    return data;
  },

  /** Admin-only; the database also refuses a user changing their own roles. */
  async updateRoles(profileId: string, roles: Profile["roles"]): Promise<Profile> {
    debug("updating profile roles", { profileId, roles });
    const { data, error } = await supabase
      .from("profiles")
      .update({ roles })
      .eq("id", profileId)
      .select()
      .single();
    if (error) {
      debug("updating profile roles failed", { profileId, code: error.code, message: error.message });
      throw error;
    }
    debug("updated profile roles", { profileId, roles: data?.roles });
    return data;
  },
};
