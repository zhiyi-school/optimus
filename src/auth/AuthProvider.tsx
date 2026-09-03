import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/data/supabase";
import { userData } from "@/data/services";
import type { Profile } from "@/data/types";
import { roleCan, type Capability } from "@/auth/permissions";
import { AuthContext, type AuthContextValue } from "@/auth/AuthContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      const current = await userData.getCurrentProfile();
      // `roles` can be missing if the DB is on an older migration than this
      // build expects (e.g. 0006_multi_role_admin.sql not yet applied) —
      // fall back to [] rather than crash every page that reads it.
      setProfile(current && { ...current, roles: current.roles ?? [] });
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) await loadProfile();
      setLoading(false);
    });

    // A session appears before its profile is fetched. Routing that reads roles
    // must not run in that window, or a developer is sent to the dashboard.
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, nextSession) => {
        setSession(nextSession);
        if (nextSession) {
          setLoading(true);
          await loadProfile();
          setLoading(false);
        } else {
          setProfile(null);
          setLoading(false);
        }
      },
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
      throw signInError;
    }
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      setError(null);
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      if (signUpError) {
        setError(signUpError.message);
        throw signUpError;
      }
      return { requiresEmailConfirmation: !data.session };
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const can = useCallback(
    (capability: Capability) => roleCan(profile?.roles, capability),
    [profile?.roles],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      error,
      signIn,
      signUp,
      signOut,
      can,
      refreshProfile: loadProfile,
    }),
    [session, profile, loading, error, signIn, signUp, signOut, can, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
