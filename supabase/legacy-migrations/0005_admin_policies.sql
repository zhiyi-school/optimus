-- Supports the Admin page (Security Team): creating teams, assigning users
-- to teams, activating/deactivating users, and linking/editing
-- applications. `role` and `id` stay hard-blocked for the authenticated
-- client no matter who's asking — that boundary is unchanged. `is_active`
-- is relaxed to let the security role toggle it (suspend/reinstate an
-- account never grants new privileges the way a role change would).

create policy teams_write on teams for insert to authenticated
  with check (current_app_role() = 'security');

create policy teams_update on teams for update to authenticated
  using (current_app_role() = 'security')
  with check (current_app_role() = 'security');

create policy profiles_update_by_security on profiles for update to authenticated
  using (current_app_role() = 'security')
  with check (current_app_role() = 'security');

create or replace function prevent_role_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    if new.role is distinct from old.role or new.id is distinct from old.id then
      raise exception 'role and id can only be changed by an administrator';
    end if;
    if new.is_active is distinct from old.is_active and current_app_role() <> 'security' then
      raise exception 'is_active can only be changed by the security team or an administrator';
    end if;
  end if;
  return new;
end;
$$;
