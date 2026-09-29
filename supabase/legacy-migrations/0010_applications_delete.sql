-- Allow Security/Admin to delete an application — used to clean up
-- accidental duplicates from the "Add App" flow. No delete policy existed
-- for `applications` before this, so RLS's default-deny silently blocked
-- it. Deleting cascades (via existing FKs) to that app's assessments,
-- findings, and tickets, and transitively to their messages/history/
-- evidence — the UI warns about this before calling it.

create policy applications_delete on applications for delete to authenticated
  using (has_role('security') or has_role('admin'));
