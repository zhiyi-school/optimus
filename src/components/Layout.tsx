import { Link, NavLink, Outlet } from "react-router-dom";
import { ShieldCheck, LogOut, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { useTeams } from "@/hooks/queries";
import { initialsOf } from "@/lib/people";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const roleLabels: Record<string, string> = {
  developer: "Developer Team",
  security: "Security Team",
  cio: "CIO",
  admin: "Admin",
};

export function Layout() {
  const { profile, can, signOut } = useAuth();
  const { data: teams } = useTeams();
  const team = teams?.find((t) => t.id === profile?.team_id);

  const navItems = [
    { to: "/assessments", label: "Assess", show: can("view_assessments") },
    { to: "/tickets", label: "Resolve", show: can("view_tickets") },
    { to: "/learn", label: "Learn", show: true },
    { to: "/admin", label: "Admin", show: can("access_admin") },
  ].filter((item) => item.show);

  return (
    <div className="min-h-screen bg-muted">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-card shadow-sm">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-foreground">
              {import.meta.env.VITE_APP_NAME ?? "Mobile Security"}
            </span>
          </Link>

          <nav className="flex h-full flex-1 items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    isActive && "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40">
                <Avatar>
                  <AvatarFallback>
                    {profile ? initialsOf(profile.display_name || profile.email) : "?"}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-[10rem] truncate text-sm font-medium text-foreground">
                    {profile?.display_name ?? profile?.email}
                  </span>
                  <span className="block max-w-[10rem] truncate text-xs text-muted-foreground">
                    {team?.name ?? "Unassigned"}
                  </span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <span className="block truncate font-medium text-foreground">
                  {profile?.display_name ?? profile?.email}
                </span>
                <span className="block truncate">
                  {profile ? profile.roles.map((r) => roleLabels[r]).join(" · ") : ""}
                </span>
                <span className="block truncate">{team?.name ?? "Unassigned"}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <NavLink to="/settings" className="flex items-center gap-2">
                  <SettingsIcon className="h-3.5 w-3.5" />
                  Settings
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void signOut()}
                className="flex items-center gap-2 text-danger focus:text-danger"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
