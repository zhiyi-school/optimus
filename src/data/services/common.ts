import { supabase } from "@/data/supabase";
import { createDebug } from "@/lib/debug";
import { UserFacingError } from "@/lib/utils";

const debug = createDebug("data:users");

export async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    debug("no authenticated user", { code: error?.code, message: error?.message });
    throw new UserFacingError("Not authenticated.");
  }
  debug("resolved authenticated user", { userId: data.user.id });
  return data.user.id;
}
