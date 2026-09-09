import { useQueryClient } from "@tanstack/react-query";

export function useInvalidateQueries() {
  const queryClient = useQueryClient();
  return (keys: readonly (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
