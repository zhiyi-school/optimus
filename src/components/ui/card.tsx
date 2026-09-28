/**
 * Card container and its header, title, description, content and footer sections.
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

/** Card header stacking title and description. */
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...props} />
  );
}

/** Card heading text. */
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    />
  );
}

/** Muted secondary text under a card title. */
export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)} {...props} />
  );
}

/** Padded card body. */
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-2", className)} {...props} />;
}

/** Right-aligned action row with a top border. */
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2 border-t border-border/70 p-4 pt-3", className)}
      {...props}
    />
  );
}
