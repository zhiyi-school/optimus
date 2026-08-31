import { useEffect, useState } from "react";
import { appTypeIcon } from "@/lib/entity-icons";
import { applicationIconUrl, type ApplicationIconSource } from "@/lib/application-icon";
import { cn } from "@/lib/utils";
import type { Application } from "@/data/types";

interface ApplicationIconProps {
  application: (ApplicationIconSource & Pick<Application, "app_type" | "name">) | null | undefined;
  /** Tailwind sizing for the outer box, e.g. `h-9 w-9`. */
  className?: string;
  iconClassName?: string;
}

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
          onError={() => setFailed(true)}
        />
      ) : (
        <FallbackIcon className={cn("text-foreground", iconClassName)} />
      )}
    </div>
  );
}
