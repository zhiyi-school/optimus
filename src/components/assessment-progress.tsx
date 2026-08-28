import { Check, HelpCircle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProvisioningStage } from "@/api/automation-types";

type StageIcon = "active" | "check" | "empty" | "failed" | "unknown";

interface Stage {
  id: string;
  label: string;
  /** Omitted when the label already says everything. */
  description?: string;
  icon: StageIcon;
}

function StageList({ stages }: { stages: Stage[] }) {
  return (
    <ol>
      {stages.map((stage, i) => (
        <li key={stage.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            {stage.icon === "check" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3.5 w-3.5" />
              </div>
            )}
            {stage.icon === "active" && (
              <Loader2
                aria-hidden="true"
                className="h-6 w-6 shrink-0 animate-spin text-primary motion-reduce:animate-none"
              />
            )}
            {stage.icon === "empty" && (
              <div className="h-6 w-6 shrink-0 rounded-full border-2 border-border" />
            )}
            {stage.icon === "failed" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger text-white">
                <X className="h-3.5 w-3.5" />
              </div>
            )}
            {stage.icon === "unknown" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5" />
              </div>
            )}
            {i < stages.length - 1 && (
              <div
                className={cn(
                  "w-px flex-1",
                  stage.icon === "empty" || stage.icon === "unknown" ? "bg-border" : "bg-primary/40",
                )}
              />
            )}
          </div>
          <div className={cn("pb-5", i === stages.length - 1 && "pb-0")}>
            <p
              className={cn(
                "text-sm font-semibold",
                stage.icon === "failed" && "text-danger",
                stage.icon === "active" && "text-primary",
                stage.icon === "empty" || stage.icon === "unknown"
                  ? "text-muted-foreground"
                  : stage.icon !== "failed" && stage.icon !== "active" && "text-foreground",
              )}
            >
              {stage.label}
            </p>
            {stage.description && (
              <p className="text-xs text-muted-foreground">{stage.description}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

const STATE_ICONS: Record<ProvisioningStage["state"], StageIcon> = {
  done: "check",
  in_progress: "active",
  pending: "empty",
  failed: "failed",
  unknown: "unknown",
};

/**
 * Setup and run progress. The first three stages come from the backend and
 * complete independently of one another; testing and reporting follow, and
 * are derived from the assessment's own progress.
 */
export function EnvironmentSetupStages({
  ready = false,
  stages: reported,
  assessment,
}: {
  ready?: boolean;
  stages?: ProvisioningStage[];
  assessment?: { status: string; completed_tests: number; total_tests: number } | null;
}) {
  const setup: Stage[] = reported?.length
    ? reported.map((s) => ({
        id: s.id,
        label: s.label,
        description: s.detail || undefined,
        icon: STATE_ICONS[s.state] ?? "empty",
      }))
    : [
        {
          id: "app_registered",
          label: ready ? "Server environment prepared" : "Server environment is being prepared",
          icon: ready ? "check" : "active",
        },
        {
          id: "service_online",
          label: "Assessment service is running",
          icon: ready ? "check" : "empty",
        },
        {
          id: "configuration_applied",
          label: ready ? "Configuration applied" : "Configuration is being applied",
          icon: ready ? "check" : "empty",
        },
      ];

  const completed = assessment?.completed_tests ?? 0;
  const total = assessment?.total_tests ?? 0;
  const testingDone = assessment?.status === "completed";
  const testingRunning = assessment?.status === "running";

  const progress = total > 0 ? `${completed} of ${total} security tests run.` : undefined;
  const testing: Stage = testingDone
    ? { id: "testing", label: "Automated testing complete", description: progress, icon: "check" }
    : testingRunning
      ? { id: "testing", label: "Automated testing in progress", description: progress, icon: "active" }
      : { id: "testing", label: "Automated testing", icon: "empty" };

  const analysis: Stage = {
    id: "analysis",
    label: "Analysis & reporting",
    icon: testingDone ? "check" : "empty",
  };

  return <StageList stages={[...setup, testing, analysis]} />;
}

/** Execution and reporting only — the environment is already set up by this point. */
export function TestRunStages({
  testingDescription = "Automated security testing is now in progress.",
}: {
  testingDescription?: string;
}) {
  const stages: Stage[] = [
    {
      id: "testing",
      label: "Testing has begun",
      description: testingDescription,
      icon: "active",
    },
    {
      id: "analysis",
      label: "Analysis & reporting",
      description: "Results will be analyzed and the report will be generated.",
      icon: "empty",
    },
  ];
  return <StageList stages={stages} />;
}
