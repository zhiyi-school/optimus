import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, ImageOff, Info, X } from "lucide-react";
import { automationAssetUrl } from "@/api/automation-client";
import type {
  DemonstrationBlock,
  DemonstrationImage,
  DemonstrationStep,
  DemonstrationStepsBlock,
  DemonstrationTableBlock,
} from "@/api/automation-types";
import { EmptyState, LoadingState } from "@/components/common";
import { RiskGoal } from "@/components/risk-goal";
import { renderInline } from "@/lib/inline-markdown";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRiskCatalogue, useAssessment } from "@/hooks/queries";

function SetupTable({ block }: { block: DemonstrationTableBlock }) {
  const columns = useMemo(() => {
    const seen: string[] = [];
    for (const row of block.rows ?? []) {
      for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
    }
    return seen;
  }, [block.rows]);

  if (!block.rows?.length) return null;

  return (
    <div>
      {block.label && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {block.label}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index} className="border-b border-border/70 last:border-0">
                {columns.map((column, columnIndex) => (
                  <td
                    key={column}
                    className={
                      columnIndex === 0
                        ? "w-44 bg-muted/40 px-3 py-2 align-top font-medium text-foreground"
                        : "break-words px-3 py-2 align-top text-muted-foreground"
                    }
                  >
                    {renderInline(row[column]) ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StepImage({ image }: { image: DemonstrationImage }) {
  if (image.exists === false || !image.url) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        {image.caption || "Reference screenshot unavailable."}
      </div>
    );
  }
  return (
    <figure className="overflow-hidden rounded-lg border border-border">
      <img
        src={automationAssetUrl(image.url)}
        alt={image.caption || "Reference screenshot"}
        className="w-full"
        loading="lazy"
      />
      {image.caption && (
        <figcaption className="border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {renderInline(image.caption)}
        </figcaption>
      )}
    </figure>
  );
}

function Step({ step, index }: { step: DemonstrationStep; index: number }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1 space-y-3 pb-6">
        <p className="text-sm text-foreground">{renderInline(step.text)}</p>
        {step.commands?.map((command, commandIndex) => (
          <pre
            key={commandIndex}
            className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs text-foreground"
          >
            <code>{command}</code>
          </pre>
        ))}
        {step.images?.map((image, imageIndex) => (
          <StepImage key={image.path || imageIndex} image={image} />
        ))}
      </div>
    </div>
  );
}

function Steps({ block }: { block: DemonstrationStepsBlock }) {
  if (!block.items?.length) return null;
  return (
    <div>
      {block.label && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {block.label}
        </p>
      )}
      <div>
        {block.items.map((step, index) => (
          <Step key={step.id || index} step={step} index={index} />
        ))}
      </div>
    </div>
  );
}

function Block({ block }: { block: DemonstrationBlock }) {
  if (block.type === "table") return <SetupTable block={block} />;
  if (block.type === "steps") return <Steps block={block} />;
  return null;
}

export default function ManualTestSteps() {
  const { assessmentId, testId } = useParams<{ assessmentId: string; testId: string }>();
  const { data: assessment, isLoading } = useAssessment(assessmentId);
  const platform = assessment?.application?.platform;
  const { data: risks } = useRiskCatalogue(platform);
  const risk = useMemo(() => risks?.find((r) => r.risk_id === testId), [risks, testId]);
  const blocks = useMemo(
    () => (risk?.demonstration ?? []).filter((block) => block && typeof block === "object"),
    [risk],
  );

  if (isLoading) return <LoadingState label="Loading…" />;

  return (
    <Card>
      <CardContent className="py-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileText className="h-4.5 w-4.5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">
                Manual Testing Steps{risk ? `: ${risk.name}` : ""}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Follow these steps to manually verify this risk.
              </p>
            </div>
          </div>
          <Link
            to={`/assessments/${assessmentId}/tests/${testId}`}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </Link>
        </div>

        {risk?.goal && (
          <div className="mb-6 flex items-start gap-2 rounded-lg bg-primary/5 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <RiskGoal risk={risk} />
          </div>
        )}

        {blocks.length === 0 ? (
          <EmptyState title="Manual steps for this test haven't been written yet." />
        ) : (
          <div className="space-y-6">
            {blocks.map((block, index) => (
              <Block key={block.id || index} block={block} />
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end border-t border-border/70 pt-4">
          <Link to={`/assessments/${assessmentId}/tests/${testId}`}>
            <Button variant="outline">Back to test</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
