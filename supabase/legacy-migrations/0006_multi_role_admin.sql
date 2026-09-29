-- Multi-role support + a dedicated `admin` role, separate from `security`.
-- See docs/DATABASE.md for the full rationale. Summary:
--   - profiles.role (single text) -> profiles.roles (text[]) — a user can
--     hold more than one role (e.g. both `security` and `admin`).
--   - New role: `admin`. Access to the Admin page (teams, user-team
--     assignment, application ownership, activate/deactivate accounts)
--     now requires the `admin` role specifically — holding `security`
--     alone is no longer sufficient.
--   - Changing anyone's `roles` still requires `admin`, and — new — no one
--     can change their own `roles` through the app, even an admin, to
--     prevent any single compromised admin session from self-escalating
--     further or silently de-escalating audit trails. `id` stays
--     hard-blocked for everyone, as before.

-- ---------------------------------------------------------------------------
-- 1. Add roles[] alongside the old role column, backfill, constrain.
-- ---------------------------------------------------------------------------

alter table profiles add column roles text[];
update profiles set roles = array[role]::text[] where roles is null;
alter table profiles alter column roles set not null;
alter table profiles alter column roles set default array['developer']::text[];
alter table profiles add constraint profiles_roles_valid
  check (roles <@ array['developer', 'security', 'cio', 'admin']::text[]);
alter table profiles add constraint profiles_roles_nonempty
  check (array_length(roles, 1) > 0);

-- ---------------------------------------------------------------------------
-- 2. has_role() replaces current_app_role() as the RLS primitive.
-- ---------------------------------------------------------------------------

create function has_role(check_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and check_role = any(roles)
  );
$$;

create or replace function can_access_application(app_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    has_role('security') or has_role('cio')
    or exists (
      select 1 from applications
      where id = app_id and developer_team_id = current_team_id()
    );
$$;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, roles)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    array['developer']::text[]
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function prevent_role_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    if new.id is distinct from old.id then
      raise exception 'id cannot be changed';
    end if;
    if new.roles is distinct from old.roles then
      if old.id = auth.uid() then
        raise exception 'you cannot change your own roles — ask another administrator';
      end if;
      if not has_role('admin') then
        raise exception 'roles can only be changed by an administrator';
      end if;
    end if;
    if new.is_active is distinct from old.is_active and not has_role('admin') then
      raise exception 'is_active can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Rewrite every policy that referenced current_app_role() directly.
-- ---------------------------------------------------------------------------

alter policy applications_write on applications
  with check (has_role('security') or has_role('admin'));
alter policy applications_update on applications
  using (has_role('security') or has_role('admin'))
  with check (has_role('security') or has_role('admin'));

alter policy assessments_write on assessments
  with check (has_role('security'));
alter policy assessments_update on assessments
  using (has_role('security'))
  with check (has_role('security'));

alter policy findings_write on findings
  with check (has_role('security'));
alter policy findings_update on findings
  using (has_role('security'))
  with check (has_role('security'));

alter policy finding_history_write on finding_history
  with check (has_role('security'));

alter policy tickets_insert on tickets
  with check (
    created_by = auth.uid()
    and (
      has_role('security')
      or (has_role('developer') and can_access_application(application_id))
    )
  );
alter policy tickets_update on tickets
  using (
    has_role('security')
    or (has_role('developer') and can_access_application(application_id))
  )
  with check (
    has_role('security')
    or (has_role('developer') and can_access_application(application_id))
  );

alter policy ticket_messages_insert on ticket_messages
  with check (
    author_id = auth.uid()
    and (has_role('developer') or has_role('security'))
    and can_access_ticket(ticket_id)
  );

alter policy ticket_attachments_insert on ticket_attachments
  with check (
    uploaded_by = auth.uid()
    and (has_role('developer') or has_role('security'))
    and can_access_ticket(ticket_id)
  );

alter policy evidence_insert on evidence
  with check (
    (has_role('developer') or has_role('security'))
    and (
      (finding_id is not null and exists (
        select 1 from findings where findings.id = evidence.finding_id
          and can_access_application(findings.application_id)
      ))
      or (ticket_id is not null and can_access_ticket(ticket_id))
    )
  );

alter policy retest_runs_insert on retest_runs
  with check (
    requested_by = auth.uid()
    and (has_role('developer') or has_role('security'))
    and can_access_ticket(ticket_id)
  );
alter policy retest_runs_update on retest_runs
  using (has_role('security'))
  with check (has_role('security'));

alter policy risk_acceptance_insert on risk_acceptance
  with check (
    requested_by = auth.uid()
    and (has_role('developer') or has_role('security'))
    and can_access_ticket(ticket_id)
  );
alter policy risk_acceptance_update on risk_acceptance
  using (has_role('security'))
  with check (has_role('security'));

alter policy ticket_attachments_object_insert on storage.objects
  with check (
    bucket_id = 'ticket-attachments'
    and (has_role('developer') or has_role('security'))
    and can_access_ticket_object(name)
  );

alter policy evidence_object_insert on storage.objects
  with check (
    bucket_id = 'evidence'
    and (has_role('developer') or has_role('security'))
    and can_access_evidence_object(name)
  );

-- ---------------------------------------------------------------------------
-- 4. Admin-only policies: teams and other users' profiles now require the
--    `admin` role specifically, not `security`.
-- ---------------------------------------------------------------------------

alter policy teams_write on teams
  with check (has_role('admin'));
alter policy teams_update on teams
  using (has_role('admin'))
  with check (has_role('admin'));

drop policy profiles_update_by_security on profiles;
create policy profiles_update_by_admin on profiles for update to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---------------------------------------------------------------------------
-- 5. Drop the now-unreferenced single-role function and column.
-- ---------------------------------------------------------------------------

drop function current_app_role();
alter table profiles drop column role;
