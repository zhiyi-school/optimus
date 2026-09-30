/**
 * Read-only summary of the new assessment shown before it is created.
 */

import type { Platform } from "@/database/types";
import { ConnectorStatusBadge } from "./connector-status-badge";
import { PLATFORMS, type Connector } from "./options";

/** Renders a label and value row in the review summary. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

/** Summarizes the details, contacts and connector the assessment will be created with. */
export function Review({
  name,
  version,
  platform,
  identifier,
  emails,
  connector,
  error,
}: {
  name: string;
  version: string;
  platform: Platform;
  identifier: string;
  emails: string[];
  connector: Connector | undefined;
  error: string | null;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-foreground">Please review your assessment details</h2>

      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          1. Assessment Details
        </h3>
        <dl className="space-y-2 text-sm">
          <Detail label="Application Name" value={name || "—"} />
          <Detail label="Version" value={version || "—"} />
          <Detail label="Testing type" value="Black box testing" />
          <Detail
            label="Asset class"
            value={PLATFORMS.find((option) => option.value === platform)?.review ?? platform}
          />
          {platform === "android" && <Detail label="Package name" value={identifier || "—"} />}
        </dl>
      </div>

      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          2. Contact Points
        </h3>
        {emails.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contacts added.</p>
        ) : (
          <>
            <p className="mb-1 text-sm font-medium text-foreground">Email contacts ({emails.length})</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {emails.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          3. Connectors
        </h3>
        {connector ? (
          <div className="flex items-center gap-2">
            <connector.icon className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{connector.name}</span>
            <ConnectorStatusBadge available={connector.available} />
          </div>
        ) : (
          <p className="text-sm text-danger">No connector selected.</p>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
