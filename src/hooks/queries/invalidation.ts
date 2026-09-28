/**
 * Hook for invalidating several React Query keys at once.
 */

import { useQueryClient } from "@tanstack/react-query";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:invalidation");

/** Returns a function that invalidates every given query key and resolves when all invalidations settle. */
export function useInvalidateQueries() {
  const queryClient = useQueryClient();
  return (keys: readonly (readonly unknown[])[]) => {
    debug("invalidates keys", keys);
    return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  };
}
