/**
 * Button that downloads a run's SARIF report export.
 */

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assessmentApi } from "@/automation-api/endpoints";
import { createDebug } from "@/lib/debug";
import { sarifFileName } from "@/domain/run/sarif";
import { errorMessage } from "@/lib/utils";

const debug = createDebug("components:assessment:download-sarif-button");

/** Renders the SARIF download button when an export is available for the run. */
export function DownloadSarifButton({
  runTimestamp,
  available,
}: {
  runTimestamp: string | undefined;
  available: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available || !runTimestamp) return null;

  /** Fetches the SARIF blob and saves it via a temporary link, reporting missing or failed exports. */
  async function download() {
    if (!runTimestamp) return;
    debug("downloads SARIF", { runTimestamp });
    setBusy(true);
    setError(null);
    try {
      const blob = await assessmentApi.downloadReportSarif(runTimestamp);
      if (!blob) {
        debug("finds no SARIF export", { runTimestamp });
        setError("No SARIF export is available for this run.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = sarifFileName(runTimestamp);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      debug("downloaded SARIF", { runTimestamp, size: blob.size });
    } catch (err) {
      debug("SARIF download fails", { runTimestamp }, err);
      setError(errorMessage(err, "Could not download the SARIF export."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void download()}>
        <Download className="mr-1.5 h-3.5 w-3.5" />
        {busy ? "Preparing…" : "Download SARIF"}
      </Button>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
