import {
  Accessibility,
  AppWindow,
  Camera,
  Clipboard,
  CreditCard,
  Database,
  Fingerprint,
  KeyRound,
  Landmark,
  Layers,
  Lock,
  ShieldQuestion,
  Smartphone,
  Usb,
  Wallet,
  Wifi,
  type LucideIcon,
} from "lucide-react";

export function appTypeIcon(appType: string | null | undefined): LucideIcon {
  const t = (appType ?? "").toLowerCase();
  if (t.includes("bank")) return Landmark;
  if (t.includes("wallet")) return Wallet;
  if (t.includes("pay")) return CreditCard;
  return Smartphone;
}

const RISK_ICON_RULES: [pattern: RegExp, icon: LucideIcon][] = [
  [/screen|capture|record/, Camera],
  [/root|jailbreak/, Fingerprint],
  [/ssl|pinning|tls|encrypt/, Lock],
  [/storage|database/, Database],
  [/network|traffic/, Wifi],
  [/auth|session|login|token/, KeyRound],
  [/usb|debug/, Usb],
  [/accessib/, Accessibility],
  [/webview|browser/, AppWindow],
  [/clipboard/, Clipboard],
  [/overlay/, Layers],
];

export function riskIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  for (const [pattern, icon] of RISK_ICON_RULES) {
    if (pattern.test(n)) return icon;
  }
  return ShieldQuestion;
}
