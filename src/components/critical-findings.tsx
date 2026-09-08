import { useMemo, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ToneBadge } from "@/components/resolve-display";
import { LoadingState, ErrorState } from "@/components/common";
import { downloadFile } from "@/lib/download";
import {
  findingAsText,
  severityCounts,
  severityTone,
  type CriticalFinding,
  type CriticalFindings,
} from "@/lib/critical-findings";
import { errorMessage } from "@/lib/utils";

function SeverityBadge({ severity }: { severity: string }) {
  return <ToneBadge tone={severityTone[severity] ?? "neutral"} label={severity} />;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded text-xs text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function DownloadLink({
  url,
  filename,
  label,
  onError,
}: {
  url: string | undefined;
  filename: string;
  label: string;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!url) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadFile(url, filename);
        } catch (error) {
          onError(errorMessage(error, `${label} could not be downloaded.`));
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-progress disabled:opacity-60"
    >
      <Download className="h-3.5 w-3.5" />
      {busy ? "Downloading…" : label}
    </button>
  );
}

function FindingRow({ finding }: { finding: CriticalFinding }) {
  return (
    <tr className="border-b border-border/70 align-top last:border-0">
      <td className="w-24 px-3 py-2">
        <SeverityBadge severity={finding.severity} />
      </td>
      <td className="px-3 py-2">
        <p className="break-words text-sm font-medium text-foreground">{finding.title}</p>
        {finding.recommendation && (
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {finding.recommendation}
          </p>
        )}
      </td>
      <td className="px-3 py-2">
        {finding.evidence.length === 0 ? (
          <span className="text-xs text-muted-foreground">No details recorded.</span>
        ) : (
          <ul className="space-y-1">
            {finding.evidence.map((line, index) => (
              <li key={index} className="flex items-start gap-1.5">
                <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  {line}
                </code>
                <CopyButton value={line} label={`Copy detail ${index + 1} of ${finding.title}`} />
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="w-8 px-2 py-2">
        <CopyButton value={findingAsText(finding)} label={`Copy ${finding.title}`} />
      </td>
    </tr>
  );
}

export function CriticalFindingsTable({
  findings,
  isLoading,
  isError,
  onRetry,
  jsonUrl,
  markdownUrl,
}: {
  findings: CriticalFindings | undefined;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  jsonUrl?: string;
  markdownUrl?: string;
}) {
  const [severity, setSeverity] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const counts = useMemo(() => severityCounts(findings?.findings ?? []), [findings]);
  const visible = useMemo(
    () =>
      (findings?.findings ?? []).filter((finding) => !severity || finding.severity === severity),
    [findings, severity],
  );

  if (isLoading) return <LoadingState label="Loading static analysis…" />;
  if (isError) {
    return (
      <ErrorState
        message="The automation backend could not provide this run's static analysis."
        onRetry={onRetry}
      />
    );
  }
  if (!findings || findings.findings.length === 0) return null;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Static analysis findings</h3>
            <span className="text-xs text-muted-foreground">
              {findings.findings.length === 1 ? "1 finding" : `${findings.findings.length} findings`}
            </span>
            {findings.highestSeverity && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                highest <SeverityBadge severity={findings.highestSeverity} />
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DownloadLink
              url={jsonUrl}
              filename="critical_findings.json"
              label="Download JSON"
              onError={setDownloadError}
            />
            <DownloadLink
              url={markdownUrl}
              filename="critical_findings.md"
              label="Download Markdown"
              onError={setDownloadError}
            />
          </div>
        </div>

        {findings.owaspReference && (
          <p className="mb-3 text-xs text-muted-foreground">{findings.owaspReference}</p>
        )}
        {downloadError && <p className="mb-3 text-xs text-danger">{downloadError}</p>}

        <div
          role="group"
          aria-label="Filter findings by severity"
          className="mb-3 flex flex-wrap items-center gap-2"
        >
          <button
            type="button"
            aria-pressed={severity === null}
            onClick={() => setSeverity(null)}
            className={filterClass(severity === null)}
          >
            All ({findings.findings.length})
          </button>
          {counts.map((entry) => (
            <button
              key={entry.severity}
              type="button"
              aria-pressed={severity === entry.severity}
              onClick={() => setSeverity(severity === entry.severity ? null : entry.severity)}
              className={filterClass(severity === entry.severity)}
            >
              {entry.severity} ({entry.count})
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full table-fixed text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="w-24 px-3 py-2 font-medium">
                  Severity
                </th>
                <th scope="col" className="w-2/5 px-3 py-2 font-medium">
                  Finding
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Evidence
                </th>
                <th scope="col" className="w-8 px-2 py-2">
                  <span className="sr-only">Copy</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            No findings at this severity.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function filterClass(active: boolean): string {
  return [
    "rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    active
      ? "border-primary bg-primary/5 text-foreground"
      : "border-border text-muted-foreground hover:text-foreground",
  ].join(" ");
}
