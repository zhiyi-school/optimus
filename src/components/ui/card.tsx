/**
 * Card container and its padded content section.
 */

import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Bordered, rounded card surface. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card shadow-card",
        className,
      )}
      {...props}
    />
  );
}

/** Padded card body. */
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-2", className)} {...props} />;
}
