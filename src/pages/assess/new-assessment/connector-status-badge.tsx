/**
 * Badge showing whether an assessment connector is available.
 */

import { Badge } from "@/components/ui/badge";

/** Shows whether a connector is available. */
export function ConnectorStatusBadge({ available }: { available: boolean }) {
  return (
    <Badge tone={available ? "success" : "neutral"}>{available ? "Available" : "Unavailable"}</Badge>
  );
}
