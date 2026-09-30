/**
 * The editable sections of the new assessment form: details, contact points and connector.
 */

import type { RefObject } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createDebug } from "@/lib/debug";
import { cn } from "@/lib/utils";
import type { Platform } from "@/database/types";
import { ConnectorStatusBadge } from "./connector-status-badge";
import { CONNECTORS, type FormSection } from "./options";
import { PlatformChoice } from "./platform-choice";

const debug = createDebug("pages:assess:new-assessment:details-form");

export interface DetailsFormProps {
  sectionRefs: Record<FormSection, RefObject<HTMLDivElement>>;
  name: string;
  onNameChange: (value: string) => void;
  version: string;
  onVersionChange: (value: string) => void;
  platform: Platform;
  onPlatformChange: (value: Platform) => void;
  identifier: string;
  onIdentifierChange: (value: string) => void;
  appType: string;
  onAppTypeChange: (value: string) => void;
  emails: string[];
  onEmailChange: (index: number, value: string) => void;
  onEmailRemove: (index: number) => void;
  onEmailAdd: () => void;
  connector: string;
  onConnectorChange: (id: string) => void;
  error: string | null;
}

/** Renders the three form sections, each registered with its scroll target. */
export function DetailsForm({
  sectionRefs,
  name,
  onNameChange,
  version,
  onVersionChange,
  platform,
  onPlatformChange,
  identifier,
  onIdentifierChange,
  appType,
  onAppTypeChange,
  emails,
  onEmailChange,
  onEmailRemove,
  onEmailAdd,
  connector,
  onConnectorChange,
  error,
}: DetailsFormProps) {
  return (
    <div className="space-y-8">
      <div ref={sectionRefs[1]} className="space-y-3 scroll-mt-4">
        <h2 className="text-sm font-semibold text-foreground">1. Assessment Details</h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Application Name
          </label>
          <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. ABC Banking" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Version</label>
          <Input value={version} onChange={(e) => onVersionChange(e.target.value)} placeholder="e.g. 3.2.1" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Testing type</label>
          <Select disabled value="black-box">
            <option value="black-box">Black box testing</option>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">Defaulted to black box testing.</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Asset class</p>
          <PlatformChoice value={platform} onChange={onPlatformChange} />
        </div>
        {platform === "android" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Package name<span className="text-danger"> *</span>
            </label>
            <Input
              value={identifier}
              onChange={(e) => onIdentifierChange(e.target.value)}
              placeholder="e.g. com.example.app"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Required — this is how the backend finds the app on the test device.
            </p>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            App Type (optional)
          </label>
          <Input
            value={appType}
            onChange={(e) => onAppTypeChange(e.target.value)}
            placeholder="e.g. Banking, Wallet, Payments"
          />
        </div>
      </div>

      <div ref={sectionRefs[2]} className="space-y-3 scroll-mt-4 border-t border-border/70 pt-6">
        <h2 className="text-sm font-semibold text-foreground">2. Contact Points</h2>
        <p className="text-xs text-muted-foreground">
          Add the key email contacts for this assessment.
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Email contacts</label>
          <div className="space-y-2">
            {emails.map((email, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => onEmailChange(i, e.target.value)}
                  placeholder="name@example.com"
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => onEmailRemove(i)}
                  className="text-muted-foreground hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 border-primary text-primary hover:bg-primary/5"
            onClick={onEmailAdd}
          >
            <Plus className="h-3.5 w-3.5" />
            Add email
          </Button>
        </div>
      </div>

      <div ref={sectionRefs[3]} className="space-y-3 scroll-mt-4 border-t border-border/70 pt-6">
        <h2 className="text-sm font-semibold text-foreground">3. Connectors</h2>
        <p className="text-xs text-muted-foreground">
          Select one connector to run this assessment with.
        </p>
        <div className="space-y-2">
          {CONNECTORS.map((c) => {
            const selected = connector === c.id;
            return (
              <button
                key={c.id}
                type="button"
                disabled={!c.available}
                onClick={() => {
                  debug("selects connector", { connector: c.id });
                  onConnectorChange(c.id);
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left",
                  selected
                    ? "border-primary bg-primary/5"
                    : c.available
                      ? "border-border hover:border-primary/40"
                      : "cursor-not-allowed border-border opacity-60",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                    selected ? "border-primary" : "border-border",
                  )}
                >
                  {selected && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </div>
                <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{c.name}</span>
                    <ConnectorStatusBadge available={c.available} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
