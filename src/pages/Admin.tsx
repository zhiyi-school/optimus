import { useState } from "react";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/common";
import { DataTable, type DataTableColumn, PlatformBadge } from "@/components/data-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/auth/AuthProvider";
import {
  useApplications,
  useCreateTeam,
  useProfiles,
  useSetUserActive,
  useTeams,
  useUpdateApplication,
  useUpdateProfileRoles,
  useUpdateProfileTeam,
} from "@/hooks/queries";
import { formatShortDate } from "@/lib/utils";
import type { Application, Profile, Team, TeamType, UserRole } from "@/data/types";

const roleLabels: Record<UserRole, string> = {
  developer: "Developer Team",
  security: "Security Team",
  cio: "CIO",
  admin: "Admin",
};

const allRoles: UserRole[] = ["developer", "security", "cio", "admin"];

const teamTypeLabels: Record<TeamType, string> = {
  developer: "Developer",
  security: "Security",
  management: "Management",
};

export default function Admin() {
  const { profile } = useAuth();
  const { data: profiles, isLoading: profilesLoading, isError: profilesError, refetch: refetchProfiles } = useProfiles();
  const { data: teams, isLoading: teamsLoading, isError: teamsError, refetch: refetchTeams } = useTeams();
  const {
    data: applications,
    isLoading: appsLoading,
    isError: appsError,
    refetch: refetchApps,
  } = useApplications();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Admin"
        description="Manage teams, user-team assignments, and application ownership."
      />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Teams</h2>
          <NewTeamDialog />
        </div>
        {teamsLoading && <LoadingState label="Loading teams…" />}
        {teamsError && <ErrorState message="Unable to load teams." onRetry={() => refetchTeams()} />}
        {!teamsLoading && !teamsError && (teams ?? []).length === 0 && (
          <EmptyState title="No teams yet." description="Create a team to start assigning users and applications." />
        )}
        {!teamsLoading && (teams ?? []).length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(teams ?? []).map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2.5 font-medium text-foreground">{t.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{teamTypeLabels[t.type]}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{formatShortDate(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Users</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          A user can hold more than one role. You can change anyone else's roles, but not your
          own — that always requires another admin, or direct database access (see
          docs/SUPABASE_SETUP.md), so a single admin session can never self-escalate.
        </p>
        {profilesLoading && <LoadingState label="Loading users…" />}
        {profilesError && <ErrorState message="Unable to load users." onRetry={() => refetchProfiles()} />}
        {!profilesLoading && !profilesError && (profiles ?? []).length > 0 && (
          <UserTable profiles={profiles ?? []} teams={teams ?? []} currentUserId={profile?.id} />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Applications</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Assign each application to a developer team so that team's developers can see its
          findings and tickets.
        </p>
        {appsLoading && <LoadingState label="Loading applications…" />}
        {appsError && <ErrorState message="Unable to load applications." onRetry={() => refetchApps()} />}
        {!appsLoading && !appsError && (applications ?? []).length === 0 && (
          <EmptyState title="No applications yet." />
        )}
        {!appsLoading && (applications ?? []).length > 0 && (
          <ApplicationTable applications={applications ?? []} teams={teams ?? []} />
        )}
      </section>
    </div>
  );
}

function UserTable({
  profiles,
  teams,
  currentUserId,
}: {
  profiles: Profile[];
  teams: Team[];
  currentUserId: string | undefined;
}) {
  const updateTeam = useUpdateProfileTeam();
  const setActive = useSetUserActive();

  const columns: DataTableColumn<Profile>[] = [
    { key: "name", header: "Name", render: (p) => <span className="font-medium text-foreground">{p.display_name || "—"}</span> },
    { key: "email", header: "Email", render: (p) => p.email },
    {
      key: "roles",
      header: "Roles",
      render: (p) => (
        <div className="flex flex-wrap items-center gap-1">
          {p.roles.map((r) => (
            <Badge key={r}>{roleLabels[r]}</Badge>
          ))}
          <EditRolesDialog profile={p} isSelf={p.id === currentUserId} />
        </div>
      ),
    },
    {
      key: "team",
      header: "Team",
      render: (p) => (
        <Select
          value={p.team_id ?? ""}
          onChange={(e) =>
            updateTeam.mutate({ profileId: p.id, teamId: e.target.value || null })
          }
        >
          <option value="">Unassigned</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => (
        <Button
          size="sm"
          variant="outline"
          disabled={setActive.isPending}
          onClick={() => setActive.mutate({ profileId: p.id, isActive: !p.is_active })}
        >
          {p.is_active ? "Active" : "Inactive"}
        </Button>
      ),
    },
  ];

  return <DataTable columns={columns} rows={profiles} />;
}

function EditRolesDialog({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<UserRole>>(new Set(profile.roles));
  const updateRoles = useUpdateProfileRoles();

  function toggle(role: UserRole) {
    const next = new Set(selected);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setSelected(next);
  }

  async function onSave() {
    if (selected.size === 0) return;
    await updateRoles.mutateAsync({ profileId: profile.id, roles: [...selected] });
    setOpen(false);
  }

  if (isSelf) {
    return (
      <span title="You cannot change your own roles.">
        <Button size="sm" variant="ghost" disabled>
          Edit
        </Button>
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit roles</DialogTitle>
          <DialogDescription>
            {profile.display_name || profile.email} — a user can hold more than one role.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {allRoles.map((role) => (
            <label key={role} className="flex items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted">
              <input
                type="checkbox"
                checked={selected.has(role)}
                onChange={() => toggle(role)}
                className="h-3.5 w-3.5"
              />
              {roleLabels[role]}
            </label>
          ))}
        </div>
        {selected.size === 0 && (
          <p className="text-xs text-danger">A user must have at least one role.</p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={updateRoles.isPending || selected.size === 0} onClick={() => void onSave()}>
            {updateRoles.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplicationTable({ applications, teams }: { applications: Application[]; teams: Team[] }) {
  const updateApp = useUpdateApplication();

  const columns: DataTableColumn<Application>[] = [
    { key: "name", header: "Application", render: (a) => <span className="font-medium text-foreground">{a.name}</span> },
    { key: "version", header: "Version", render: (a) => a.version ?? "—" },
    { key: "platform", header: "Platform", render: (a) => <PlatformBadge platform={a.platform} /> },
    {
      key: "team",
      header: "Developer Team",
      render: (a) => (
        <Select
          value={a.developer_team_id ?? ""}
          onChange={(e) =>
            updateApp.mutate({
              applicationId: a.id,
              patch: { developer_team_id: e.target.value || null },
            })
          }
        >
          <option value="">Unassigned</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      ),
    },
    { key: "edit", header: "", render: (a) => <EditApplicationDialog application={a} /> },
  ];

  return <DataTable columns={columns} rows={applications} />;
}

function NewTeamDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<TeamType>("developer");
  const create = useCreateTeam();

  async function onSubmit() {
    if (!name.trim()) return;
    await create.mutateAsync({ name: name.trim(), type });
    setName("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          New Team
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>Create a team to assign users and applications to.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mobile App Team" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
            <Select value={type} onChange={(e) => setType(e.target.value as TeamType)}>
              <option value="developer">Developer</option>
              <option value="security">Security</option>
              <option value="management">Management</option>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={create.isPending || !name.trim()} onClick={() => void onSubmit()}>
            {create.isPending ? "Creating…" : "Create Team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditApplicationDialog({ application }: { application: Application }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(application.name);
  const [version, setVersion] = useState(application.version ?? "");
  const [appType, setAppType] = useState(application.app_type ?? "");
  const [ownerName, setOwnerName] = useState(application.owner_name ?? "");
  const [ownerEmail, setOwnerEmail] = useState(application.owner_email ?? "");
  const [devName, setDevName] = useState(application.developer_contact_name ?? "");
  const [devEmail, setDevEmail] = useState(application.developer_contact_email ?? "");
  const update = useUpdateApplication();

  async function onSubmit() {
    await update.mutateAsync({
      applicationId: application.id,
      patch: {
        name: name.trim(),
        version: version.trim() || null,
        app_type: appType.trim() || null,
        owner_name: ownerName.trim() || null,
        owner_email: ownerEmail.trim() || null,
        developer_contact_name: devName.trim() || null,
        developer_contact_email: devEmail.trim() || null,
      },
    });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit application</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Version</label>
              <Input value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">App Type</label>
            <Input value={appType} onChange={(e) => setAppType(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="App owner name" />
            <Input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="App owner email" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input value={devName} onChange={(e) => setDevName(e.target.value)} placeholder="Developer contact name" />
            <Input value={devEmail} onChange={(e) => setDevEmail(e.target.value)} placeholder="Developer contact email" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={update.isPending || !name.trim()} onClick={() => void onSubmit()}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
