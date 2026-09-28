import { useMutation, useQuery } from "@tanstack/react-query";
import { applicationData } from "@/data/services/applications";
import { teamData } from "@/data/services/teams";
import { userData } from "@/data/services/users";
import type { UserRole } from "@/data/types";
import { useInvalidateQueries } from "./invalidation";
import { assessmentKeys, evidenceKeys, referenceKeys, ticketKeys } from "@/hooks/query-keys";
import { createDebug } from "@/lib/debug";

const debug = createDebug("hooks:queries:reference");

const REFERENCE_DATA_STALE_TIME_MS = 5 * 60_000;

export function useProfiles() {
  return useQuery({
    queryKey: referenceKeys.profiles(),
    queryFn: async () => {
      debug("fetches profiles");
      const rows = await userData.listProfiles();
      debug("fetched profiles", { count: rows.length });
      return rows;
    },
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
  });
}

export function useTeams() {
  return useQuery({
    queryKey: referenceKeys.teams(),
    queryFn: async () => {
      debug("fetches teams");
      const rows = await teamData.list();
      debug("fetched teams", { count: rows.length });
      return rows;
    },
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
  });
}

export function useApplications() {
  return useQuery({
    queryKey: referenceKeys.applications(),
    queryFn: async () => {
      debug("fetches applications");
      const rows = await applicationData.list();
      debug("fetched applications", { count: rows.length });
      return rows;
    },
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
  });
}

export function useCreateTeam() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: teamData.create,
    onMutate: (team) => debug("creates team", { type: team.type }),
    onError: (error) => debug("create team failed", { error }),
    onSuccess: () => {
      debug("created team");
      return invalidate([referenceKeys.teams()]);
    },
  });
}

export function useUpdateProfileTeam() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({ profileId, teamId }: { profileId: string; teamId: string | null }) =>
      userData.updateTeam(profileId, teamId),
    onMutate: ({ profileId, teamId }) => debug("updates profile team", { profileId, teamId }),
    onError: (error, { profileId }) => debug("update profile team failed", { profileId, error }),
    onSuccess: () => invalidate([referenceKeys.profiles()]),
  });
}

export function useUpdateProfileRoles() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({ profileId, roles }: { profileId: string; roles: UserRole[] }) =>
      userData.updateRoles(profileId, roles),
    onMutate: ({ profileId, roles }) => debug("updates profile roles", { profileId, roles }),
    onError: (error, { profileId }) => debug("update profile roles failed", { profileId, error }),
    onSuccess: () => invalidate([referenceKeys.profiles()]),
  });
}

export function useSetUserActive() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({ profileId, isActive }: { profileId: string; isActive: boolean }) =>
      userData.setActive(profileId, isActive),
    onMutate: ({ profileId, isActive }) => debug("sets user active", { profileId, isActive }),
    onError: (error, { profileId }) => debug("set user active failed", { profileId, error }),
    onSuccess: () => invalidate([referenceKeys.profiles()]),
  });
}

export function useUpdateApplication() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({ applicationId, patch }: { applicationId: string; patch: Parameters<typeof applicationData.update>[1] }) =>
      applicationData.update(applicationId, patch),
    onMutate: ({ applicationId, patch }) =>
      debug("updates application", { applicationId, fields: Object.keys(patch) }),
    onError: (error, { applicationId }) => debug("update application failed", { applicationId, error }),
    onSuccess: () =>
      invalidate([referenceKeys.applications(), assessmentKeys.all(), evidenceKeys.findings(), ticketKeys.metrics()]),
  });
}

export function useDeleteApplication() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({ applicationId, applicationName }: { applicationId: string; applicationName: string }) =>
      applicationData.remove(applicationId, applicationName),
    onMutate: ({ applicationId }) => debug("deletes application", { applicationId }),
    onError: (error, { applicationId }) => debug("delete application failed", { applicationId, error }),
    onSuccess: () =>
      invalidate([
        referenceKeys.applications(),
        assessmentKeys.all(),
        evidenceKeys.findings(),
        ticketKeys.withRelations(),
        ticketKeys.metrics(),
      ]),
  });
}
