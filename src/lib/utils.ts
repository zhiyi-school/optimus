/**
 * Shared formatting, ordering, class-name and error-message helpers.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names, letting later Tailwind classes override conflicting earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats a timestamp as a local date and time, or an em dash when missing or invalid. */
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

/** Formats a timestamp as a local date, or an em dash when missing or invalid. */
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

/** Formats seconds as `12.3s` under a minute, else `Xm Ys`; an em dash when missing. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

/** Case-insensitive, numeric-aware name comparison; the keys break ties deterministically. */
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

  /** Creates an error whose message is safe to show to users. */
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** Returns a user-facing error's message, else logs the error and returns the fallback so internals never show. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && (err as { userFacing?: unknown }).userFacing === true) {
    const { message } = err as { message?: unknown };
    if (typeof message === "string" && message.length > 0) return message;
  }
  console.error(fallback, err);
  return fallback;
}

/** Formats a byte count as B, KB or MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "1 step" or "N steps". */
export function stepCountLabel(count: number): string {
  return count === 1 ? "1 step" : `${count} steps`;
}
