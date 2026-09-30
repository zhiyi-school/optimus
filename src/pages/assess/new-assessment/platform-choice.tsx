/**
 * Radio group for choosing the new assessment's platform.
 */

import type { KeyboardEvent } from "react";
import { createDebug } from "@/lib/debug";
import { cn } from "@/lib/utils";
import type { Platform } from "@/database/types";
import { PLATFORMS } from "./options";

const debug = createDebug("pages:assess:new-assessment:platform-choice");

/** Radio group for choosing the platform, with arrow-key navigation. */
export function PlatformChoice({
  value,
  onChange,
}: {
  value: Platform;
  onChange: (platform: Platform) => void;
}) {
  /** Moves the platform selection and focus with arrow keys, wrapping at either end. */
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = ["ArrowRight", "ArrowDown"].includes(event.key)
      ? 1
      : ["ArrowLeft", "ArrowUp"].includes(event.key)
        ? -1
        : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + PLATFORMS.length) % PLATFORMS.length;
    debug("moves platform selection", { key: event.key, platform: PLATFORMS[next].value });
    onChange(PLATFORMS[next].value);
    (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Asset class" className="grid grid-cols-2 gap-2 sm:max-w-sm">
      {PLATFORMS.map((option, index) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              debug("selects platform", { platform: option.value });
              onChange(option.value);
            }}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              "flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              selected
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                selected ? "border-primary" : "border-border",
              )}
            >
              {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </span>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
