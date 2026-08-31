import { supabase } from "@/data/supabase";
import { UserFacingError } from "@/lib/utils";

export async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new UserFacingError("Not authenticated.");
  return data.user.id;
}
