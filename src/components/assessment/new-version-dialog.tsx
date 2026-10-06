/**
 * Dialog that starts a new assessment of an already-assessed app, letting iOS choose which intake build is tested.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { useAppBuilds } from "@/hooks/queries/automation";
import { useRequestNewAssessment } from "@/hooks/queries/assessments";
import { buildOptionLabel, selectableVersions } from "@/domain/assessment/build-versions";
import { applicationLabel } from "@/domain/status-labels";
import { createDebug } from "@/lib/debug";
import { errorMessage } from "@/lib/utils";
import type { AppBuild } from "@/automation-api/types";
import type { Application } from "@/database/types";

const debug = createDebug("components:assessment:new-version-dialog");

interface NewVersionDialogProps {
  application: Application;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Lists the app's builds with the highest version preselected, then starts the assessment and opens its progress. */
export function NewVersionDialog({ application, open, onOpenChange }: NewVersionDialogProps) {
  const navigate = useNavigate();
  const ios = application.platform === "ios";
  const builds = useAppBuilds(application.platform, application.external_id, open && ios);
  const requestNew = useRequestNewAssessment();
  const versions = useMemo(() => selectableVersions(builds.data?.builds ?? []), [builds.data]);
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!open) return;
    setVersion(builds.data?.default_version ?? versions[0] ?? "");
  }, [open, builds.data, versions]);

  const buildsReady = !ios || (!!builds.data && !builds.data.ambiguous && versions.length > 0);
  const canStart = buildsReady && !requestNew.isPending && (!ios || !!version);

  /** Starts the assessment for the chosen version and opens its progress on the Assessments page. */
  function start() {
    const buildVersion = ios ? version : null;
    debug("starts new version assessment", { applicationId: application.id, buildVersion });
    requestNew.mutate(
      { applicationId: application.id, buildVersion },
      {
        onSuccess: (assessment) => {
          onOpenChange(false);
          navigate(`/assessments?expanded=${encodeURIComponent(assessment.id)}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assess a new version of {applicationLabel(application)}</DialogTitle>
          <DialogDescription>
            Runs every security test again as a new assessment. Findings, tickets and conversations carry
            over, and earlier assessments stay on the app&apos;s page.
          </DialogDescription>
        </DialogHeader>

        {ios ? (
          <BuildPicker
            loading={builds.isLoading}
            failed={builds.isError}
            unavailable={!builds.isLoading && !builds.isError && builds.data === null}
            ambiguous={!!builds.data?.ambiguous}
            builds={builds.data?.builds ?? []}
            versions={versions}
            defaultVersion={builds.data?.default_version ?? null}
            version={version}
            onChange={setVersion}
          />
        ) : (
          <p className="text-sm text-foreground">
            Android tests the version installed on the test device. Install the version you want before starting.
          </p>
        )}

        {requestNew.isError && (
          <p className="text-xs text-danger">{errorMessage(requestNew.error, "Could not start the assessment.")}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canStart} onClick={start}>
            {requestNew.isPending ? "Starting…" : "Start assessment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The iOS version choice, or the reason no build can be chosen yet. */
function BuildPicker({
  loading,
  failed,
  unavailable,
  ambiguous,
  builds,
  versions,
  defaultVersion,
  version,
  onChange,
}: {
  loading: boolean;
  failed: boolean;
  unavailable: boolean;
  ambiguous: boolean;
  builds: AppBuild[];
  versions: string[];
  defaultVersion: string | null;
  version: string;
  onChange: (version: string) => void;
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading the available builds…</p>;
  if (failed || unavailable) {
    return <p className="text-sm text-danger">The automation backend could not list this app&apos;s builds.</p>;
  }
  if (ambiguous) {
    return (
      <p className="text-sm text-danger">
        More than one app in the intake folder matches this one, so no build can be chosen. Remove the ones that
        don&apos;t belong.
      </p>
    );
  }
  if (versions.length === 0) {
    return (
      <p className="text-sm text-foreground">
        No build of this app is in the intake folder yet. Add its IPA to the automation host&apos;s intake folder,
        then open this again.
      </p>
    );
  }
  const selected = builds.find((build) => build.version === version);
  return (
    <label className="block text-sm text-foreground">
      <span className="mb-1 block font-medium">Version to test</span>
      <Select className="w-full" value={version} onChange={(event) => onChange(event.target.value)}>
        {versions.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate === defaultVersion ? `${candidate} (highest)` : candidate}
          </option>
        ))}
      </Select>
      {selected && <span className="mt-1 block text-xs text-muted-foreground">{buildOptionLabel(selected)}</span>}
    </label>
  );
}
