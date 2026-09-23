import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/data-display";
import { mapVerdictToFindingStatus } from "@/data/sync";
import type { LatestResultDetail } from "@/lib/automation-evidence";
import type { RiskVerdict } from "@/api/automation-types";

const STATUS_LABELS: Record<string, string> = {
  CAPTURE_PIPELINE_SILENT: "Capture pipeline silent",
  CAPTURE_DATA_INVALID: "Capture data invalid",
  CAPTURE_SOURCE_CHANGED: "Capture source changed",
  CAPTURE_SOURCE_UNAVAILABLE: "Capture source unavailable",
  TRAFFIC_INTERCEPTION_NOT_OBSERVED: "Traffic interception not observed",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function LatestResultPanel({ result }: { result: LatestResultDetail | undefined }) {
  if (!result) return null;
  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Latest automated result</h3>
          <StatusBadge status={mapVerdictToFindingStatus(result.verdict as RiskVerdict)} />
        </div>
        <p className="mb-3 break-words text-sm text-foreground">{result.summary}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Field label="Verdict" value={result.verdict} />
          <Field label="Status" value={STATUS_LABELS[result.status] ?? result.status} />
          <Field label="Run" value={result.runTimestamp} />
          <Field label="Started" value={result.startedAt} />
          {result.duration && <Field label="Duration" value={result.duration} />}
          <Field label="Test" value={result.testName} />
          <Field label="Test id" value={result.testId} />
        </dl>
      </CardContent>
    </Card>
  );
}
