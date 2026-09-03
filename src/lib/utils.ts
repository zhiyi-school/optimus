import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

/**
 * Case-insensitive, numeric-aware name ordering shared by every alphabetical
 * list. `aKey`/`bKey` break a tie deterministically when names compare equal
 * or are both missing.
 */
export function compareByName(
  aName: string | null | undefined,
  bName: string | null | undefined,
  aKey: string,
  bKey: string,
): number {
  const cmp = (aName ?? "").localeCompare(bName ?? "", undefined, {
    sensitivity: "base",
    numeric: true,
  });
  return cmp !== 0 ? cmp : aKey.localeCompare(bKey);
}

/** An error whose message was written to be shown to users. */
export class UserFacingError extends Error {
  readonly userFacing = true;

  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/**
 * The message to display for anything thrown. Only deliberately user-facing
 * messages are shown; everything else — database errors, backend validator
 * output, unexpected exceptions — would disclose schema, config or internal
 * structure, so it goes to the console and the caller's generic text is
 * displayed instead.
 *
 * Checked by marker property rather than `instanceof`, which is unreliable
 * when a module is loaded twice.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && (err as { userFacing?: unknown }).userFacing === true) {
    const { message } = err as { message?: unknown };
    if (typeof message === "string" && message.length > 0) return message;
  }
  console.error(fallback, err);
  return fallback;
}
