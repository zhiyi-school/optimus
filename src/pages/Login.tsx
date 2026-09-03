import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import {
  Building2,
  CheckCircle2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { defaultRouteFor } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type Mode = "signin" | "signup";

const SAMPLE_THREAD = [
  {
    author: "AppSec Expert",
    time: "10:24 AM",
    tone: "bg-primary/10",
    message: "We found that account info is exposed in screen capture.",
  },
  {
    author: "You (Developer)",
    time: "10:37 AM",
    tone: "bg-success/10",
    message: "Thanks! Can you advise how to fix this?",
  },
  {
    author: "AppSec Expert",
    time: "11:22 AM",
    tone: "bg-primary/10",
    message: "Retest passed. Marking as resolved! 🎉",
    resolved: true,
  },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "Enterprise grade security" },
  { icon: Lock, label: "SOC 2 Type II compliant" },
  { icon: ShieldCheck, label: "Your data is always protected" },
];

export default function Login() {
  const { session, profile, loading: authLoading, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The landing route reads roles, so it waits for the profile rather than
  // falling back to the dashboard while one is still being fetched.
  if (session && authLoading) return <LoadingState label="Loading your workspace…" />;
  if (session) return <Navigate to={defaultRouteFor(profile)} replace />;

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        const { requiresEmailConfirmation } = await signUp(email, password, displayName);
        if (requiresEmailConfirmation) {
          setNotice("Check your email to confirm your account, then sign in below.");
          setMode("signin");
          setPassword("");
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === "signin"
            ? "Unable to sign in."
            : "Unable to create account.",
      );
    } finally {
      setLoading(false);
    }
  }

  const appName = import.meta.env.VITE_APP_NAME ?? "AppSec";

  return (
    <div className="flex min-h-screen flex-col bg-muted/60">
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-10 px-6 py-12 md:grid-cols-2 md:items-center">
        <div>
          <div className="mb-8 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold text-foreground">{appName}</span>
          </div>

          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-foreground">
            Security found an issue.
            <br />
            You don&apos;t have to
            <br />
            <span className="text-primary">fix it alone.</span>
          </h1>

          <div className="mt-8 space-y-4 rounded-xl border border-border/70 bg-card p-5 shadow-card">
            {SAMPLE_THREAD.map((m, i) => (
              <div key={i} className="flex gap-3">
                <Avatar className={m.tone}>
                  <AvatarFallback className="text-foreground">
                    {m.author.startsWith("You") ? "YD" : "AE"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-foreground">{m.author}</span>
                    <span className="text-xs text-muted-foreground">{m.time}</span>
                  </div>
                  <p className={`text-sm ${m.resolved ? "font-medium text-success" : "text-foreground"}`}>
                    {m.resolved && <CheckCircle2 className="mr-1 inline h-4 w-4 align-text-bottom" />}
                    {m.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto w-full max-w-md rounded-xl border border-border/70 bg-card p-8 shadow-card">
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-bold text-foreground">Welcome to {appName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "signin" ? "Sign in to continue" : "Create your account"}
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">Name</label>
                <Input
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Email address</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="name@example.com"
                  className="h-11 pl-9"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  required
                  minLength={mode === "signup" ? 6 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  className="h-11 pl-9"
                />
              </div>
            </div>
            {notice && <p className="text-xs text-success">{notice}</p>}
            {error && <p className="text-xs text-danger">{error}</p>}
            <Button type="submit" className="h-11 w-full text-sm" disabled={loading}>
              <Mail className="h-4 w-4" />
              {loading
                ? mode === "signin"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium text-muted-foreground">OR</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div
            title="Enterprise SSO isn't available yet"
            className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-border bg-muted/50 text-sm font-medium text-muted-foreground"
          >
            <Building2 className="h-4 w-4" />
            Continue with Enterprise SSO
          </div>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            {mode === "signin" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="font-medium text-primary hover:underline"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="font-medium text-primary hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>

          <div className="mt-6 flex items-center justify-center gap-4 border-t border-border/70 pt-5">
            {TRUST_BADGES.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5" title={label}>
                <div className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground">
                  <Icon className="h-3 w-3" />
                </div>
                <span className="hidden text-[10px] leading-tight text-muted-foreground sm:block">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="border-t border-border/70 py-5 text-center text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          {appName}
        </span>
        <span className="mx-2">·</span>
        &copy; {new Date().getFullYear()} {appName}. All rights reserved.
      </footer>
    </div>
  );
}
