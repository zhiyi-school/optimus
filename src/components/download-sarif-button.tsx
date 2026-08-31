import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assessmentApi } from "@/api/automation-services";
import { sarifFileName } from "@/lib/sarif";
import { errorMessage } from "@/lib/utils";

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

  async function download() {
    if (!runTimestamp) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await assessmentApi.downloadReportSarif(runTimestamp);
      if (!blob) {
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
    } catch (err) {
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
