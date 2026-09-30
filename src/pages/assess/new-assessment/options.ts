/**
 * Steps, connectors and platforms offered by the new assessment form.
 */

import { Boxes, ShieldCheck, Terminal } from "lucide-react";
import type { Platform } from "@/database/types";

export type Screen = "form" | "review";

export type FormSection = 1 | 2 | 3;

export const STEPS = [
  { key: 1, label: "Assessment Details" },
  { key: 2, label: "Contact Points" },
  { key: 3, label: "Connectors" },
  { key: 4, label: "Review & Create" },
];

export const CONNECTORS = [
  {
    id: "custom-appsec",
    icon: ShieldCheck,
    name: "custom-appsec",
    description: "AppSec's own automation backend — runs the configured automated security tests against this app.",
    available: true,
  },
  {
    id: "mobsf",
    icon: Boxes,
    name: "mobsf",
    description: "Mobile Security Framework (MobSF) static analysis.",
    available: false,
  },
  {
    id: "owasp-zap",
    icon: Terminal,
    name: "owasp-zap",
    description: "OWASP ZAP dynamic analysis tool.",
    available: false,
  },
];

export type Connector = (typeof CONNECTORS)[number];

export const PLATFORMS: { value: Platform; label: string; review: string }[] = [
  { value: "ios", label: "iOS", review: "iOS mobile app" },
  { value: "android", label: "Android", review: "Android mobile app" },
];
