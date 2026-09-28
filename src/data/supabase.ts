import { createClient } from "@supabase/supabase-js";
import { createDebug } from "@/lib/debug";

const debug = createDebug("data:supabase");

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  debug("missing Supabase configuration", {
    hasUrl: !!supabaseUrl,
    hasAnonKey: !!supabaseAnonKey,
  });
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. Copy .env.example to .env and fill them in.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

debug("client configured", { url: supabaseUrl, persistSession: true, autoRefreshToken: true });

export const ATTACHMENTS_BUCKET = "ticket-attachments";
export const EVIDENCE_BUCKET = "evidence";
