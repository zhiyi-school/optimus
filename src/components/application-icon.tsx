/**
 * Application icon with an app-type fallback.
 */

import { useEffect, useState } from "react";
import { appTypeIcon } from "@/domain/assessment/entity-icons";
import { applicationIconUrl, type ApplicationIconSource } from "@/domain/assessment/application-icon";
import { createDebug } from "@/lib/debug";
import { cn } from "@/lib/utils";
import type { Application } from "@/database/types";

const debug = createDebug("component:application-icon");

interface ApplicationIconProps {
  application: (ApplicationIconSource & Pick<Application, "app_type" | "name">) | null | undefined;
  className?: string;
  iconClassName?: string;
}

/** Shows the application's icon image, falling back to its app-type icon when absent or broken. */
export function ApplicationIcon({
  application,
  className = "h-9 w-9",
  iconClassName = "h-4 w-4",
}: ApplicationIconProps) {
  const url = applicationIconUrl(application);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [url]);

  const FallbackIcon = appTypeIcon(application?.app_type);
  const showImage = url !== null && !failed;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/40",
        className,
      )}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => {
            debug("falls back after icon load fails", { application: application?.name });
            setFailed(true);
          }}
        />
      ) : (
        <FallbackIcon className={cn("text-foreground", iconClassName)} />
      )}
    </div>
  );
}
