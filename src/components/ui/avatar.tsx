/**
 * Circular avatar primitives styled over Radix Avatar.
 */

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Circular avatar container. */
export function Avatar({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10",
        className,
      )}
      {...props}
    />
  );
}

/** Initials shown when the avatar has no image. */
export function AvatarFallback({
  className,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn("text-xs font-semibold text-primary", className)}
      {...props}
    />
  );
}
