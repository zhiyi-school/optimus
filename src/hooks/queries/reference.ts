import { useMutation, useQuery } from "@tanstack/react-query";
import { applicationData } from "@/data/services/applications";
import { teamData } from "@/data/services/teams";
import { userData } from "@/data/services/users";
import type { UserRole } from "@/data/types";
import { useInvalidateQueries } from "./invalidation";
import { assessmentKeys, evidenceKeys, referenceKeys, ticketKeys } from "@/hooks/query-keys";

const REFERENCE_DATA_STALE_TIME_MS = 5 * 60_000;

export function useProfiles() {
  return useQuery({
    queryKey: referenceKeys.profiles(),
    queryFn: userData.listProfiles,
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
  });
}

export function useTeams() {
  return useQuery({
    queryKey: referenceKeys.teams(),
    queryFn: teamData.list,
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
  });
}

export function useApplications() {
  return useQuery({
    queryKey: referenceKeys.applications(),
    queryFn: applicationData.list,
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
  });
}

export function useCreateTeam() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: teamData.create,
    onSuccess: () => invalidate([referenceKeys.teams()]),
  });
}

export function useUpdateProfileTeam() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({ profileId, teamId }: { profileId: string; teamId: string | null }) =>
      userData.updateTeam(profileId, teamId),
    onSuccess: () => invalidate([referenceKeys.profiles()]),
  });
}

export function useUpdateProfileRoles() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({ profileId, roles }: { profileId: string; roles: UserRole[] }) =>
      userData.updateRoles(profileId, roles),
    onSuccess: () => invalidate([referenceKeys.profiles()]),
  });
}

export function useSetUserActive() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({ profileId, isActive }: { profileId: string; isActive: boolean }) =>
      userData.setActive(profileId, isActive),
    onSuccess: () => invalidate([referenceKeys.profiles()]),
  });
}

export function useUpdateApplication() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({ applicationId, patch }: { applicationId: string; patch: Parameters<typeof applicationData.update>[1] }) =>
      applicationData.update(applicationId, patch),
    onSuccess: () =>
      invalidate([referenceKeys.applications(), assessmentKeys.all(), evidenceKeys.findings(), ticketKeys.metrics()]),
  });
}

export function useDeleteApplication() {
  const invalidate = useInvalidateQueries();
  return useMutation({
    mutationFn: ({ applicationId, applicationName }: { applicationId: string; applicationName: string }) =>
      applicationData.remove(applicationId, applicationName),
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
