import { createContext } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Profile } from "@/data/types";
import type { Capability } from "@/auth/permissions";

export interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  /** Blocking initialization only: no usable profile has been established yet. */
  loading: boolean;
  /** A same-user profile refresh in flight; the current profile stays usable. */
  profileRefreshing: boolean;
  error: string | null;
  /** Set when a profile load failed; a background failure keeps the old profile. */
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<{ requiresEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  can: (capability: Capability) => boolean;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
