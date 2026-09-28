/**
 * Resolving an application's icon URL from the automation backend.
 */

import { iconApi } from "@/api/automation-services";
import type { AutomationPlatform } from "@/api/automation-types";
import type { Application } from "@/data/types";

export type ApplicationIconSource = Pick<
  Application,
  "external_id" | "platform" | "icon_ref" | "icon_extraction_status"
> &
  Partial<Pick<Application, "artifact_sha256">>;

/** The app's backend icon URL, or null when it is unlinked, has no icon, or extraction failed. */
export function applicationIconUrl(
  application: ApplicationIconSource | null | undefined,
): string | null {
  if (!application?.external_id || !application.icon_ref) return null;
  if (application.icon_extraction_status && application.icon_extraction_status !== "available") {
    return null;
  }
  return iconApi.url(
    application.platform as AutomationPlatform,
    application.external_id,
    application.artifact_sha256 ?? undefined,
  );
}
