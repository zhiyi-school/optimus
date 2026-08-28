import type { UserRole } from "@/data/types";

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export const roleLabel: Record<UserRole, string> = {
  developer: "Developer",
  security: "Security Team",
  cio: "CIO",
  admin: "Admin",
};

export const roleBubbleTone: Record<UserRole, string> = {
  developer: "bg-success/10",
  security: "bg-primary/10",
  cio: "bg-muted",
  admin: "bg-muted",
};
