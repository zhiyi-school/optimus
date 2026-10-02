/**
 * New assessment page: collects the app's details, reviews them and creates the assessment.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCreateAssessment } from "@/hooks/assessment/create-assessment";
import { createDebug } from "@/lib/debug";
import { errorMessage, cn } from "@/lib/utils";
import type { Platform } from "@/database/types";
import { AssessmentsMiniList } from "./assessments-mini-list";
import { DetailsForm } from "./details-form";
import { CONNECTORS, STEPS, type FormSection, type Screen } from "./options";
import { Review } from "./review";

const debug = createDebug("pages:assess:new-assessment:new-assessment");

/** Collects app details, contacts and a connector, then registers the app and queues its run after review. */
export default function NewAssessment() {
  const navigate = useNavigate();
  const createAssessment = useCreateAssessment();

  const [screen, setScreen] = useState<Screen>("form");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [platform, setPlatform] = useState<Platform>("ios");
  const [identifier, setIdentifier] = useState("");
  const [appType, setAppType] = useState("");
  const [connector, setConnector] = useState("");
  const [emails, setEmails] = useState<string[]>([""]);
  const [pendingScrollStep, setPendingScrollStep] = useState<FormSection | null>(null);

  const stepOneRef = useRef<HTMLDivElement>(null);
  const stepTwoRef = useRef<HTMLDivElement>(null);
  const stepThreeRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useMemo(
    () => ({ 1: stepOneRef, 2: stepTwoRef, 3: stepThreeRef }),
    [stepOneRef, stepTwoRef, stepThreeRef],
  );

  /** Scrolls to a form section, switching back from review first or opening review for the last step. */
  const goToStep = useCallback((key: number) => {
    debug("goes to step", { step: key, screen });
    if (key === 4) {
      setScreen("review");
      return;
    }
    if (screen !== "form") {
      setScreen("form");
      setPendingScrollStep(key as FormSection);
      return;
    }
    sectionRefs[key as FormSection].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [screen, sectionRefs]);

  useEffect(() => {
    if (screen !== "form" || pendingScrollStep === null) return;
    debug("scrolls to pending step", { step: pendingScrollStep });
    sectionRefs[pendingScrollStep].current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingScrollStep(null);
  }, [screen, pendingScrollStep, sectionRefs]);

  /** Replaces the email contact at an index. */
  const updateEmail = useCallback((i: number, value: string) => {
    setEmails((prev) => prev.map((e, idx) => (idx === i ? value : e)));
  }, []);

  /** Removes the email contact at an index. */
  const removeEmail = useCallback((i: number) => {
    debug("removes email contact", { index: i });
    setEmails((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  /** Appends an empty email contact. */
  const addEmail = useCallback(() => {
    setEmails((prev) => {
      debug("adds email contact", { count: prev.length + 1 });
      return [...prev, ""];
    });
  }, []);

  const validEmails = emails.map((e) => e.trim()).filter(Boolean);
  const selectedConnector = CONNECTORS.find((c) => c.id === connector);
  const saving = createAssessment.isPending;
  const error = createAssessment.error ? errorMessage(createAssessment.error, "Unable to add app.") : null;

  /** Creates the assessment from the form and opens its progress on Assessments once it succeeds. */
  function confirm() {
    if (!name.trim()) {
      debug("rejects submission", { field: "name", rule: "required" });
      return;
    }
    createAssessment.mutate(
      {
        name: name.trim(),
        platform,
        version: version.trim(),
        identifier: identifier.trim(),
        appType: appType.trim(),
        contactEmails: validEmails,
      },
      {
        onSuccess: (assessment) => {
          const to = `/assessments?expanded=${encodeURIComponent(assessment.id)}`;
          debug("navigates after create", { to });
          navigate(to);
        },
      },
    );
  }

  const sectionDone: Record<number, boolean> = {
    1: !!name.trim() && (platform === "ios" || !!identifier.trim()),
    2: validEmails.length > 0,
    3: !!connector,
  };
  const canSubmit = sectionDone[1] && sectionDone[3];

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-1 lg:min-h-[30rem] lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside
          aria-label="Assessments"
          className="min-w-0 border-b border-border/70 p-5 lg:flex lg:flex-col lg:border-b-0 lg:border-r"
        >
          <AssessmentsMiniList />
        </aside>

        <div className="min-w-0 p-6">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {screen === "review" ? "Review & Confirm" : "New Assessment"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {screen === "review"
                  ? "Review all details before creating this security assessment."
                  : "Provide the details below to start a new security assessment."}
              </p>
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
              <DetailsForm
                sectionRefs={sectionRefs}
                name={name}
                onNameChange={setName}
                version={version}
                onVersionChange={setVersion}
                platform={platform}
                onPlatformChange={setPlatform}
                identifier={identifier}
                onIdentifierChange={setIdentifier}
                appType={appType}
                onAppTypeChange={setAppType}
                emails={emails}
                onEmailChange={updateEmail}
                onEmailRemove={removeEmail}
                onEmailAdd={addEmail}
                connector={connector}
                onConnectorChange={setConnector}
                error={error}
              />
            )}

            {screen === "review" && (
              <Review
                name={name}
                version={version}
                platform={platform}
                identifier={identifier}
                emails={validEmails}
                connector={selectedConnector}
                error={error}
              />
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
                <Button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => {
                    debug("opens review", { connector });
                    setScreen("review");
                  }}
                >
                  Next
                </Button>
              </>
            )}
            {screen === "review" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    debug("returns to form");
                    setScreen("form");
                  }}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
                <Button disabled={saving || !canSubmit} onClick={confirm}>
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
