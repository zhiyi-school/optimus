import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTeams } from "@/hooks/queries";
import { defaultConfigPath } from "@/api/automation-services";

const roleLabels: Record<string, string> = {
  developer: "Developer Team",
  security: "Security Team",
  cio: "CIO",
  admin: "Admin",
};

export default function Settings() {
  const { profile, can } = useAuth();
  const { data: teams } = useTeams();
  const team = teams?.find((t) => t.id === profile?.team_id);

  return (
    <div>
      <PageHeader title="Settings" description="Your profile and dashboard preferences." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 py-4">
            <h2 className="text-sm font-semibold text-foreground">Profile</h2>
            <Row label="Name" value={profile?.display_name ?? "—"} />
            <Row label="Email" value={profile?.email ?? "—"} />
            <Row
              label="Roles"
              value={
                profile ? (
                  <span className="flex flex-wrap justify-end gap-1">
                    {profile.roles.map((r) => (
                      <Badge key={r}>{roleLabels[r]}</Badge>
                    ))}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Row label="Team" value={team?.name ?? "Unassigned"} />
            <p className="pt-2 text-xs text-muted-foreground">
              Your roles are assigned by an administrator and cannot be changed here. Contact an
              Admin (see the Admin page) or your Supabase project administrator to request a
              change.
            </p>
          </CardContent>
        </Card>

        {can("run_test") && (
          <Card>
            <CardContent className="space-y-3 py-4">
              <h2 className="text-sm font-semibold text-foreground">Automation Backend</h2>
              <p className="text-xs text-muted-foreground">
                Automated test runs always use the backend&apos;s standard per-platform config
                files.
              </p>
              <Row label="iOS" value={<code>{defaultConfigPath("ios")}</code>} />
              <Row label="Android" value={<code>{defaultConfigPath("android")}</code>} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
