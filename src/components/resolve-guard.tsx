import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { ShieldAlert, UserCog } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { resolveAccess } from "@/auth/permissions";
import { LoadingState } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";

export function ResolveGuard({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  const access = resolveAccess(profile, loading);

  if (access === "loading") return <LoadingState label="Loading your workspace…" />;
  if (!session) return <Navigate to="/login" replace />;
  if (access === "unauthorized") {
    return (
      <Notice
        icon={<ShieldAlert className="h-5 w-5 text-danger" />}
        title="You do not have developer access"
        body="The Resolve workspace is for developers assigned to an application team. Ask an administrator to add the developer role to your account if you need it."
      />
    );
  }
  if (access === "inactive") {
    return (
      <Notice
        icon={<ShieldAlert className="h-5 w-5 text-danger" />}
        title="This account is deactivated"
        body="Your account has been deactivated. Ask an administrator to reactivate it."
      />
    );
  }
  if (access === "no_team") {
    return (
      <Notice
        icon={<UserCog className="h-5 w-5 text-warning" />}
        title="Your account is not assigned to a team yet"
        body="Applications are shared with developer teams, so nothing is visible until an administrator assigns you to one. No applications are shown in the meantime."
      />
    );
  }
  return <>{children}</>;
}

function Notice({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        {icon}
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
