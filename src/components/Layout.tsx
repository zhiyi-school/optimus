import { Suspense } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ShieldCheck, LogOut, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { LoadingState } from "@/components/common";
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

/** Nested risk, run and control routes keep their top-level tab underlined. */
const ASSESS_ROUTES = ["/assessments", "/runs"];
const RESOLVE_ROUTES = ["/resolve"];

export function Layout() {
  const { profile, can, signOut } = useAuth();
  const { data: teams } = useTeams();
  const team = teams?.find((t) => t.id === profile?.team_id);
  const { pathname } = useLocation();

  // Findings and tickets live inside their feature-risk workspace; their routes
  // stay reachable for old links but are no longer navigation destinations.
  const navItems = [
    { to: "/assessments", label: "Assess", match: ASSESS_ROUTES, show: can("view_assessments") },
    { to: "/resolve", label: "Resolve", match: RESOLVE_ROUTES, show: can("view_resolve") },
    { to: "/learn", label: "Learn", match: ["/learn"], show: true },
    { to: "/admin", label: "Admin", match: ["/admin"], show: can("access_admin") },
  ].filter((item) => item.show);

  return (
    <div className="min-h-screen bg-muted">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-card">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-8 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold text-foreground">
              {import.meta.env.VITE_APP_NAME ?? "Mobile Security"}
            </span>
          </Link>

          <nav
            aria-label="Main"
            className="flex h-full min-w-0 flex-1 items-center gap-7 overflow-x-auto"
          >
            {navItems.map((item) => {
              const active = item.match.some(
                (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
              );
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-full shrink-0 items-center border-b-2 border-transparent px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    active && "border-primary text-primary",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
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

      {/* Scoped here, not around the router: a lazy route must never unmount the header. */}
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
