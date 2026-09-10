import { KeyRound } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/common";
import type { PlaintextAnalysis, PlaintextLiteral } from "@/lib/plaintext-literals";

function SourceCell({ item }: { item: PlaintextLiteral }) {
  if (item.sourceKind === "analyzer_report") {
    return (
      <span className="text-muted-foreground">
        Reported by {item.provider}; no bundle file recorded
      </span>
    );
  }
  return (
    <span className="break-all">
      <span className="text-foreground">{item.sourcePath}</span>
      {item.keyPath && <span className="text-muted-foreground"> · {item.keyPath}</span>}
    </span>
  );
}

export function PlaintextLiteralsCard({
  analysis,
  isLoading,
  isError,
  onRetry,
  controlHref,
}: {
  analysis: PlaintextAnalysis | undefined;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  controlHref?: (controlId: string) => string;
}) {
  const ready = analysis?.state === "ready" ? analysis : undefined;
  const literals = ready?.literals ?? [];

  return (
    <Card>
      <CardContent className="py-3.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            Exposed plaintext literals
          </h3>
          {analysis?.state === "ready" && literals.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {literals.length === 1 ? "1 literal" : `${literals.length} literals`}
            </span>
          )}
        </div>

        {isLoading && <LoadingState label="Loading plaintext literals…" />}

        {!isLoading && isError && (
          <ErrorState
            message="This run's static analysis could not be loaded, so its plaintext literals are unknown."
            onRetry={onRetry}
          />
        )}

        {!isLoading && !isError && !analysis && (
          <p className="text-xs text-muted-foreground">
            No static analysis is available for this risk yet, so its plaintext literals are
            unknown.
          </p>
        )}

        {!isLoading && !isError && analysis?.state === "unsupported" && (
          <p className="text-xs text-muted-foreground">
            This run did not record structured plaintext-literal analysis, so none can be shown.
          </p>
        )}

        {!isLoading && !isError && analysis?.state === "not_scanned" && (
          <p className="text-xs text-muted-foreground">
            The plaintext-literal scan did not run for this analysis, so its results are unknown.
          </p>
        )}

        {!isLoading && !isError && analysis?.state === "ready" && literals.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No matching plaintext literals reported in this run.
          </p>
        )}

        {!isLoading && !isError && literals.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border">
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Category</th>
                    <th className="py-1.5 pr-3 font-medium">Location</th>
                    <th className="py-1.5 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {literals.map((item) => (
                    <tr key={item.id} className="align-top">
                      <td className="py-2 pr-3 text-foreground">
                        {item.categoryLabel}
                        {item.controlId && controlHref && (
                          <Link
                            to={controlHref(item.controlId)}
                            className="mt-0.5 block font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            How to fix
                          </Link>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <SourceCell item={item} />
                      </td>
                      <td className="py-2">
                        <code className="whitespace-pre-wrap break-all font-mono text-foreground">
                          {item.maskedValue}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Values are masked. Matches are pattern-based and are not confirmed to be valid
              credentials. Reported by {ready?.provider} for run {literals[0].runTimestamp}.
            </p>
            {ready?.truncated && (
              <p className="mt-1 text-xs text-warning">
                The analyzer reported this list as truncated, so more literals may exist.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
