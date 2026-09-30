/**
 * Provider that tracks the Supabase session, loads the user's profile and exposes auth actions.
 */

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
import { supabase } from "@/database/client";
import { userData } from "@/database/users";
import type { Profile } from "@/database/types";
import { roleCan, type Capability } from "@/auth/permissions";
import { AuthContext, type AuthContextValue } from "@/auth/auth-context";

/** Tracks the Supabase session and profile, clearing cached queries whenever the account changes. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authInitializing, setAuthInitializing] = useState(true);
  const [profileRefreshing, setProfileRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  const pendingUserRef = useRef<string | null>(null);
  const loadedUserRef = useRef<string | null>(null);
  const sessionUserRef = useRef<string | null>(null);

  /** Loads the current profile, ignoring stale responses; a blocking load clears the profile on failure. */
  const fetchProfile = useCallback(
    async (userId: string, { blocking }: { blocking: boolean }) => {
      const seq = ++requestSeqRef.current;
      pendingUserRef.current = userId;
      if (blocking) setAuthInitializing(true);
      else setProfileRefreshing(true);

      try {
        const current = await userData.getCurrentProfile();
        if (seq !== requestSeqRef.current) return;
        
        setProfile(current && { ...current, roles: current.roles ?? [] });
        loadedUserRef.current = current ? userId : null;
        setProfileError(null);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;

        setProfileError(err instanceof Error ? err.message : "Could not load your profile.");
        
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

  /** Drops the profile, cancels in-flight loads and clears the query cache. */
  const clearAccountState = useCallback(() => {
    requestSeqRef.current += 1;
    pendingUserRef.current = null;
    loadedUserRef.current = null;
    setProfile(null);
    setProfileError(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
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

      // A token refresh is the same user: keep the profile and never block routes on screen.
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

  /** Signs in with email and password, recording and rethrowing any error. */
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

  /** Creates an account and reports whether email confirmation is still required. */
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

  /** Signs out and clears the previous account's state. */
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // Otherwise the next sign-in reuses the previous account's cached queries.
    clearAccountState();
  }, [clearAccountState]);

  /** Reloads the profile of the current user without blocking the UI. */
  const refreshProfile = useCallback(async () => {
    const userId = loadedUserRef.current ?? pendingUserRef.current ?? sessionUserRef.current;
    if (!userId) return;
    await fetchProfile(userId, { blocking: false });
  }, [fetchProfile]);

  /** True when the current profile's roles grant the capability. */
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
