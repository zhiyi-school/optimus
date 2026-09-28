import { useQueryClient } from "@tanstack/react-query";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:invalidation");

export function useInvalidateQueries() {
  const queryClient = useQueryClient();
  return (keys: readonly (readonly unknown[])[]) => {
    debug("invalidates keys", keys);
    return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  };
}
