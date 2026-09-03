import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/data/supabase";
import { userData } from "@/data/services";
import type { Profile } from "@/data/types";
import { roleCan, type Capability } from "@/auth/permissions";
import { AuthContext, type AuthContextValue } from "@/auth/AuthContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authInitializing, setAuthInitializing] = useState(true);
  const [profileRefreshing, setProfileRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // `requestSeq` discards a response that a newer load — or a sign-out —
  // has already superseded, so no previous account's profile can land late.
  const requestSeqRef = useRef(0);
  const pendingUserRef = useRef<string | null>(null);
  const loadedUserRef = useRef<string | null>(null);
  const sessionUserRef = useRef<string | null>(null);

  const fetchProfile = useCallback(
    async (userId: string, { blocking }: { blocking: boolean }) => {
      const seq = ++requestSeqRef.current;
      pendingUserRef.current = userId;
      if (blocking) setAuthInitializing(true);
      else setProfileRefreshing(true);

      try {
        const current = await userData.getCurrentProfile();
        if (seq !== requestSeqRef.current) return;
        // `roles` can be missing if the DB is on an older migration than this
        // build expects — fall back to [] rather than crash every page.
        setProfile(current && { ...current, roles: current.roles ?? [] });
        loadedUserRef.current = current ? userId : null;
        setProfileError(null);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setProfileError(err instanceof Error ? err.message : "Could not load your profile.");
        // Only an initial load has nothing to fall back to; a refresh keeps
        // the profile and permissions already on screen.
        if (blocking) {
          setProfile(null);
          loadedUserRef.current = null;
        }
      } finally {
        if (seq === requestSeqRef.current) {
          pendingUserRef.current = null;
          setAuthInitializing(false);
          setProfileRefreshing(false);
        }
      }
    },
    [],
  );

  const clearAccountState = useCallback(() => {
    requestSeqRef.current += 1;
    pendingUserRef.current = null;
    loadedUserRef.current = null;
    setProfile(null);
    setProfileError(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    // supabase-js emits INITIAL_SESSION on subscribe, so this listener is the
    // whole initialization path: calling getSession() here as well would load
    // the profile twice.
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      const userId = nextSession?.user?.id ?? null;
      sessionUserRef.current = userId;

      if (event === "SIGNED_OUT" || !userId) {
        clearAccountState();
        setAuthInitializing(false);
        setProfileRefreshing(false);
        return;
      }

      const knownUser = loadedUserRef.current ?? pendingUserRef.current;
      if (knownUser && knownUser !== userId) clearAccountState();

      const hasProfile = loadedUserRef.current === userId;

      // A refreshed token is the same user with a new access token: keep the
      // profile, and never block the routes already on screen.
      if (event === "TOKEN_REFRESHED" && hasProfile) return;

      if (event === "USER_UPDATED") {
        void fetchProfile(userId, { blocking: false });
        return;
      }

      if (hasProfile || pendingUserRef.current === userId) {
        setAuthInitializing(false);
        return;
      }

      void fetchProfile(userId, { blocking: true });
    });

    return () => listener.subscription.unsubscribe();
  }, [clearAccountState, fetchProfile]);

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
    // Otherwise the next sign-in reuses the previous account's cached queries.
    clearAccountState();
  }, [clearAccountState]);

  const refreshProfile = useCallback(async () => {
    const userId = loadedUserRef.current ?? pendingUserRef.current ?? sessionUserRef.current;
    if (!userId) return;
    await fetchProfile(userId, { blocking: false });
  }, [fetchProfile]);

  const can = useCallback(
    (capability: Capability) => roleCan(profile?.roles, capability),
    [profile?.roles],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading: authInitializing,
      profileRefreshing,
      error,
      profileError,
      signIn,
      signUp,
      signOut,
      can,
      refreshProfile,
    }),
    [
      session,
      profile,
      authInitializing,
      profileRefreshing,
      error,
      profileError,
      signIn,
      signUp,
      signOut,
      can,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
