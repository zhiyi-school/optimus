/**
 * Hook for reading the auth context.
 */

import { useContext } from "react";
import { AuthContext } from "@/auth/AuthContext";
import { createDebug } from "@/lib/debug";

const debug = createDebug("auth:context");

/** Returns the auth context value; throws when used outside AuthProvider. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    debug("useAuth called outside AuthProvider");
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
