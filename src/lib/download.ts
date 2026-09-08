import { UserFacingError } from "@/lib/utils";

const DISPOSITION_FILENAME = /filename\*?=(?:UTF-8''|")?([^";]+)/i;

/** The server's own name for the file, when it sent one. */
export function filenameFromDisposition(header: string | null): string | undefined {
  const match = header ? DISPOSITION_FILENAME.exec(header) : null;
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]).trim() || undefined;
  } catch {
    return match[1].trim() || undefined;
  }
}

async function refusalMessage(response: Response, fallback: string): Promise<string> {
  // The backend's refusals are written for a reader and carry no host paths.
  try {
    const body = await response.clone().json();
    const detail = (body as { detail?: unknown })?.detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  } catch {
    /* not a structured refusal */
  }
  return `${fallback} (${response.status})`;
}

/**
 * Save a URL to disk through a Blob, so a refusal is reported instead of being
 * written to the file the reader asked for. The object URL is revoked whether
 * or not the click succeeds.
 */
export async function downloadFile(
  url: string,
  filename: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new UserFacingError("Could not reach the server to download this file.");
  }

  if (!response.ok) {
    throw new UserFacingError(await refusalMessage(response, "That file could not be downloaded"));
  }

  const blob = await response.blob();
  const name = filenameFromDisposition(response.headers.get("content-disposition")) ?? filename;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = name;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
