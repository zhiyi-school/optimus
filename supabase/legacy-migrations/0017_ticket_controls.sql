-- Developer remediation progress: which controls a remediation ticket requires,
-- and how far the developer has got through each control's steps.
--
-- The control text itself — Markdown, screenshots and implemented-control
-- archives — stays in the external playbook directory served by the automation
-- backend. Only workflow state and small audit metadata live here, keyed by the
-- backend's `control_id` / `step_key`. `playbook_revision` records which version
-- of the control the developer actually followed.
--
-- Mirrors the ticket_messages RLS pattern (see docs/data-model.md).

create table ticket_controls (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  control_id text not null,
  playbook_revision text,
  status text not null default 'not_started' check (
    status in ('not_started', 'in_progress', 'completed', 'needs_changes')
  ),
  required boolean not null default true,
  title text,
  step_count integer not null default 0,
  position integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references profiles (id) on delete set null,
  developer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_controls_unique_per_ticket unique (ticket_id, control_id)
);

create index idx_ticket_controls_ticket_id on ticket_controls (ticket_id);

create table ticket_control_steps (
  id uuid primary key default gen_random_uuid(),
  ticket_control_id uuid not null references ticket_controls (id) on delete cascade,
  step_key text not null,
  step_index integer not null,
  step_title text,
  status text not null default 'not_started' check (
    status in ('not_started', 'in_progress', 'completed', 'needs_changes')
  ),
  completed_at timestamptz,
  completed_by uuid references profiles (id) on delete set null,
  developer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_control_steps_unique_per_control unique (ticket_control_id, step_key)
);

create index idx_ticket_control_steps_ticket_control_id on ticket_control_steps (ticket_control_id);

create trigger trg_ticket_controls_updated_at before update on ticket_controls
  for each row execute function set_updated_at();
create trigger trg_ticket_control_steps_updated_at before update on ticket_control_steps
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Access: progress follows the ticket it belongs to, so team scoping on
-- applications carries through unchanged.
-- ---------------------------------------------------------------------------

create function can_access_ticket_control(tc_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_ticket(ticket_id) from ticket_controls where id = tc_id;
$$;

alter table ticket_controls enable row level security;
alter table ticket_control_steps enable row level security;

create policy ticket_controls_select on ticket_controls for select to authenticated
  using (can_access_ticket(ticket_id));

create policy ticket_controls_insert on ticket_controls for insert to authenticated
  with check (
    (has_role('developer') or has_role('security'))
    and can_access_ticket(ticket_id)
    and (completed_by is null or completed_by = auth.uid())
  );

create policy ticket_controls_update on ticket_controls for update to authenticated
  using (
    (has_role('developer') or has_role('security'))
    and can_access_ticket(ticket_id)
  )
  with check (
    (has_role('developer') or has_role('security'))
    and can_access_ticket(ticket_id)
    and (completed_by is null or completed_by = auth.uid())
  );

create policy ticket_control_steps_select on ticket_control_steps for select to authenticated
  using (can_access_ticket_control(ticket_control_id));

create policy ticket_control_steps_insert on ticket_control_steps for insert to authenticated
  with check (
    (has_role('developer') or has_role('security'))
    and can_access_ticket_control(ticket_control_id)
    and (completed_by is null or completed_by = auth.uid())
  );

create policy ticket_control_steps_update on ticket_control_steps for update to authenticated
  using (
    (has_role('developer') or has_role('security'))
    and can_access_ticket_control(ticket_control_id)
  )
  with check (
    (has_role('developer') or has_role('security'))
    and can_access_ticket_control(ticket_control_id)
    and (completed_by is null or completed_by = auth.uid())
  );

-- No delete policy on either table: progress is an audit trail, and RLS denies
-- anything a policy does not explicitly allow. Rows go only when their ticket does.

-- ---------------------------------------------------------------------------
-- Close the generic ticket-update hole. `tickets_update` lets a developer write
-- any column on a ticket their team owns, which would let them set `closed`
-- (or reassign the ticket) straight through the generic status mutation and
-- skip the reassessment workflow entirely. Security keeps closure, verification
-- and ownership; developers keep the states they legitimately drive.
-- ---------------------------------------------------------------------------

create function enforce_ticket_update_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  developer_statuses constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'retest_requested'];
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;
  if has_role('security') or has_role('admin') then
    return new;
  end if;

  if new.status is distinct from old.status and not (new.status = any(developer_statuses)) then
    raise exception 'only the security team can move a ticket to %', new.status;
  end if;

  if new.closed_at is distinct from old.closed_at then
    raise exception 'only the security team can close or reopen a ticket';
  end if;

  if new.type is distinct from old.type
    or new.finding_id is distinct from old.finding_id
    or new.application_id is distinct from old.application_id
    or new.created_by is distinct from old.created_by
    or new.assigned_team_id is distinct from old.assigned_team_id
    or new.assigned_user_id is distinct from old.assigned_user_id then
    raise exception 'only the security team can change a ticket''s ownership fields';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_ticket_update_permissions before update on tickets
  for each row execute function enforce_ticket_update_permissions();
