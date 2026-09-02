import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageHeader, LoadingState, ErrorState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { ToneBadge } from "@/components/resolve-display";
import {
  ControlIntro,
  ControlReferences,
  ControlSourceArchive,
  ControlSteps,
} from "@/components/control-content";
import { WorkOnRiskButton } from "@/components/ticket-actions";
import { useControlDetail, useControlSource, useFinding } from "@/hooks/queries";
import { isRequiredControl, playbookControlStatusLabels } from "@/lib/resolve";

export default function ControlPreview() {
  const { findingId, controlId } = useParams<{ findingId: string; controlId: string }>();
  const finding = useFinding(findingId);
  const platform = finding.data?.platform;

  const control = useControlDetail(platform, controlId);
  const source = useControlSource(platform, controlId);

  const backTo = `/findings/${findingId}`;

  if (finding.isLoading || control.isLoading) return <LoadingState label="Loading control…" />;
  if (finding.isError || !finding.data) {
    return (
      <ErrorState message="Unable to load this finding." onRetry={() => finding.refetch()} />
    );
  }
  if (control.isError || !control.data) {
    return (
      <div>
        <BackLink to={backTo} />
        <ErrorState
          message="The automation backend could not provide the remediation instructions for this control. Check that its playbook directory is configured and reachable."
          onRetry={() => control.refetch()}
        />
      </div>
    );
  }

  const status = playbookControlStatusLabels[control.data.status];
  const required = isRequiredControl(control.data);

  return (
    <div>
      <BackLink to={backTo} />

      <PageHeader
        title={control.data.title}
        description={control.data.summary}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToneBadge tone={status.tone} label={status.label} />
            <ToneBadge
              tone={required ? "warning" : "neutral"}
              label={required ? "Required" : "Optional"}
            />
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="space-y-3 py-4">
          <p className="text-sm text-foreground">
            You are previewing this control against{" "}
            <Link to={backTo} className="text-primary hover:underline">
              {finding.data.title}
            </Link>
            . Nothing is recorded while you read.
          </p>
          <p className="text-xs text-muted-foreground">
            These are the developer remediation steps for this control. They are not the steps
            security uses to demonstrate the risk. Start remediation when you want to track your
            progress through them.
          </p>
          {!required && (
            <p className="text-xs text-muted-foreground">
              This control is marked <strong>{control.data.status}</strong> and is not counted as
              required remediation work.
            </p>
          )}
          <WorkOnRiskButton finding={finding.data} application={finding.data.application} />
        </CardContent>
      </Card>

      <ControlIntro control={control.data} />
      <ControlSteps control={control.data} />
      <ControlReferences control={control.data} />
      <ControlSourceArchive platform={platform} controlId={controlId} source={source.data} />
    </div>
  );
}

function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to the finding
    </Link>
  );
}
