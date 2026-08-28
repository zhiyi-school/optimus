import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Boxes, ChevronLeft, Plus, ShieldCheck, Terminal, Trash2, X } from "lucide-react";
import { LoadingState } from "@/components/common";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { AssessmentStatusBadge, PlatformBadge } from "@/components/data-display";
import { useAssessments } from "@/hooks/queries";
import { syncService } from "@/data/sync";
import { appTypeIcon } from "@/lib/entity-icons";
import { latestAssessmentPerApp } from "@/lib/assessments";
import { errorMessage, formatDate, cn } from "@/lib/utils";
import type { Platform } from "@/data/types";

type Screen = "form" | "review";

const STEPS = [
  { key: 1, label: "Assessment Details" },
  { key: 2, label: "Contact Points" },
  { key: 3, label: "Connectors" },
  { key: 4, label: "Review & Create" },
];

const CONNECTORS = [
  {
    id: "custom-appsec",
    icon: ShieldCheck,
    name: "custom-appsec",
    description: "AppSec's own automation backend — runs the configured automated security tests against this app.",
    connected: true,
  },
  {
    id: "mobsf",
    icon: Boxes,
    name: "mobsf",
    description: "Mobile Security Framework (MobSF) static analysis.",
    connected: false,
  },
  {
    id: "owasp-zap",
    icon: Terminal,
    name: "owasp-zap",
    description: "OWASP ZAP dynamic analysis tool.",
    connected: false,
  },
];

export default function NewAssessment() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [screen, setScreen] = useState<Screen>("form");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [platform, setPlatform] = useState<Platform>("ios");
  const [identifier, setIdentifier] = useState("");
  const [appType, setAppType] = useState("");
  const [connector, setConnector] = useState("");
  const [emails, setEmails] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingScrollStep, setPendingScrollStep] = useState<number | null>(null);

  const sectionRefs = {
    1: useRef<HTMLDivElement>(null),
    2: useRef<HTMLDivElement>(null),
    3: useRef<HTMLDivElement>(null),
  };

  function goToStep(key: number) {
    if (key === 4) {
      setScreen("review");
      return;
    }
    if (screen !== "form") {
      setScreen("form");
      setPendingScrollStep(key);
      return;
    }
    sectionRefs[key as 1 | 2 | 3].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    if (screen !== "form" || pendingScrollStep === null) return;
    sectionRefs[pendingScrollStep as 1 | 2 | 3].current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingScrollStep(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, pendingScrollStep]);

  function updateEmail(i: number, value: string) {
    setEmails((prev) => prev.map((e, idx) => (idx === i ? value : e)));
  }
  function removeEmail(i: number) {
    setEmails((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function confirm() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { assessment, ticket } = await syncService.addApp({
        name: name.trim(),
        platform,
        version: version.trim(),
        identifier: identifier.trim(),
        appType: appType.trim(),
        contactEmails: emails.map((e) => e.trim()).filter(Boolean),
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assessments"] }),
        queryClient.invalidateQueries({ queryKey: ["applications"] }),
        queryClient.invalidateQueries({ queryKey: ["ticketsWithRelations"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboardMetrics"] }),
      ]);

      // Land on the new assessment itself, not the list — this is the point
      // in the flow where there's a real wait (the environment/app has to be
      // provisioned), and that page is what shows the setup progress. No
      // ticket means the backend already has this app's build ready to go,
      // so there's nothing to show here.
      navigate(`/assessments/${assessment.id}`, {
        state: ticket ? { provisioningTicket: { id: ticket.id, title: ticket.title } } : {},
      });
    } catch (err) {
      setError(errorMessage(err, "Unable to add app."));
    } finally {
      setSaving(false);
    }
  }

  const validEmails = emails.map((e) => e.trim()).filter(Boolean);

  const selectedConnector = CONNECTORS.find((c) => c.id === connector);

  const sectionDone: Record<number, boolean> = {
    1: !!name.trim() && (platform === "ios" || !!identifier.trim()),
    2: validEmails.length > 0,
    3: !!connector,
  };
  const canSubmit = sectionDone[1] && sectionDone[3];

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div className="border-b border-border/70 p-5 lg:col-span-5 lg:border-b-0 lg:border-r">
          <AssessmentsMiniList />
        </div>

        <div className="p-6 lg:col-span-7">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              {screen === "review" ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setScreen("form")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div>
                    <h1 className="text-xl font-bold text-foreground">Review &amp; Confirm</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Review all details before creating this security assessment.
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <h1 className="text-xl font-bold text-foreground">New Assessment</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Provide the details below to start a new security assessment.
                  </p>
                </div>
              )}
            </div>
            <Link to="/assessments" className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[auto_1fr]">
            <ol className="hidden sm:flex sm:flex-col">
              {STEPS.map((s, i) => {
                const done = s.key === 4 ? screen === "review" : sectionDone[s.key];
                return (
                  <li key={s.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                          done ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground",
                        )}
                      >
                        {s.key}
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={cn("w-px flex-1", done ? "bg-primary/40" : "bg-border")} />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => goToStep(s.key)}
                      className={cn(
                        "pb-8 text-left text-sm hover:text-primary hover:underline",
                        done ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ol>

            {screen === "form" && (
              <div className="space-y-8">
                <div ref={sectionRefs[1]} className="space-y-3 scroll-mt-4">
                  <h2 className="text-sm font-semibold text-foreground">1. Assessment Details</h2>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Application Name
                    </label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ABC Banking" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Version</label>
                    <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 3.2.1" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Testing type</label>
                    <Select disabled value="black-box">
                      <option value="black-box">Black box testing</option>
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">Defaulted to black box testing.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Asset class</label>
                    <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                      <option value="ios">iOS mobile app</option>
                      <option value="android">Android mobile app</option>
                    </Select>
                  </div>
                  {platform === "android" && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Package name<span className="text-danger"> *</span>
                      </label>
                      <Input
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
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
                      onChange={(e) => setAppType(e.target.value)}
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
                            onChange={(e) => updateEmail(i, e.target.value)}
                            placeholder="name@company.com"
                            className="flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => removeEmail(i)}
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
                      onClick={() => setEmails((prev) => [...prev, ""])}
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
                          disabled={!c.connected}
                          onClick={() => setConnector(c.id)}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-lg border p-3 text-left",
                            selected
                              ? "border-primary bg-primary/5"
                              : c.connected
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
                              <Badge tone={c.connected ? "success" : "neutral"}>
                                {c.connected ? "Connected" : "Not connected"}
                              </Badge>
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
            )}

            {screen === "review" && (
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
                    <Detail label="Asset class" value={platform === "ios" ? "iOS mobile app" : "Android mobile app"} />
                    {platform === "android" && (
                      <Detail label="Package name" value={identifier || "—"} />
                    )}
                  </dl>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    2. Contact Points
                  </h3>
                  {validEmails.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No contacts added.</p>
                  ) : (
                    <>
                      <p className="mb-1 text-sm font-medium text-foreground">
                        Email contacts ({validEmails.length})
                      </p>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                        {validEmails.map((e) => (
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
                  {selectedConnector ? (
                    <div className="flex items-center gap-2">
                      <selectedConnector.icon className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">{selectedConnector.name}</span>
                      <Badge tone="success">Connected</Badge>
                    </div>
                  ) : (
                    <p className="text-sm text-danger">No connector selected.</p>
                  )}
                </div>

                {error && <p className="text-xs text-danger">{error}</p>}
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-end gap-2 border-t border-border/70 pt-4">
            {screen === "form" && (
              <>
                <Link to="/assessments">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
                <Button type="button" disabled={!canSubmit} onClick={() => setScreen("review")}>
                  Next
                </Button>
              </>
            )}
            {screen === "review" && (
              <>
                <Button type="button" variant="outline" onClick={() => setScreen("form")}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
                <Button disabled={saving || !canSubmit} onClick={() => void confirm()}>
                  {saving ? "Registering app…" : "Confirm & Create Assessment"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function AssessmentsMiniList() {
  const { data, isLoading } = useAssessments();
  const assessments = useMemo(() => latestAssessmentPerApp(data), [data]);

  return (
    <div>
      <h2 className="text-lg font-bold text-foreground">Assessments</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">Select an application assessment to continue.</p>

      {isLoading && <LoadingState label="Loading…" />}
      {!isLoading && assessments.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">No assessments yet.</p>
      )}
      {!isLoading && assessments.length > 0 && (
        <ul className="max-h-[36rem] divide-y divide-border overflow-y-auto">
          {assessments.map((a) => {
            const Icon = appTypeIcon(a.application?.app_type);
            const pct =
              a.total_tests > 0 ? Math.min(100, Math.round((a.completed_tests / a.total_tests) * 100)) : 0;
            return (
              <li key={a.id}>
                <Link
                  to={`/assessments/${a.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-muted/50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40">
                    <Icon className="h-4 w-4 text-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {a.application?.name ?? "—"}
                      </span>
                      {a.application && <PlatformBadge platform={a.application.platform} />}
                    </div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      {a.completed_tests} of {a.total_tests}
                    </p>
                    <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <AssessmentStatusBadge status={a.status} />
                      <span className="text-xs text-muted-foreground">{formatDate(a.created_at)}</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
