-- One remediation approach per ticket.
--
-- Controls for a risk were treated as cumulative requirements: every active
-- required control was reconciled into the ticket and the developer had to
-- finish all of them. They are alternatives, so a ticket now names the one
-- approach being worked on and progress is counted only against it.
--
-- `selected_control_id` is a logical reference to a control owned by the
-- backend playbook catalogue. No playbook content is copied here, so there is
-- no foreign key and no title, summary, step text or ordering to keep in sync.
-- The frontend validates the id against the controls the backend currently
-- returns; the database only enforces that it is a non-blank identifier.
--
-- Existing progress rows are untouched. A ticket with no selection yet is
-- resolved by the frontend's first-candidate rule and persisted on the next
-- authorised work view.

alter table tickets
  add column selected_control_id text,
  add constraint tickets_selected_control_id_not_blank
    check (selected_control_id is null or btrim(selected_control_id) <> '');

-- `required` mirrored the playbook's own flag onto every reconciled row and was
-- used to decide which controls counted. Selection replaces it entirely.
alter table ticket_controls drop column required;

-- ---------------------------------------------------------------------------
-- A developer owns the approach only while they own the work. Security keeps
-- the ability to inspect and correct it; the trigger already returns early for
-- security and admin.
-- ---------------------------------------------------------------------------

create or replace function enforce_ticket_update_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  developer_statuses constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'retest_requested', 'withdrawn'];
  withdrawable_from constant text[] :=
    array['open', 'in_progress', 'fix_submitted', 'rejected'];
  security_finalised constant text[] := array['closed', 'accepted'];
  selectable_from constant text[] := array['open', 'in_progress', 'fix_submitted', 'rejected'];
  withdrawing constant boolean :=
    new.status = 'withdrawn' and old.status is distinct from 'withdrawn';
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;
  if has_role('security') or has_role('admin') then
    return new;
  end if;

  if old.status = any(security_finalised) then
    raise exception 'only the security team can reopen a ticket it has finalised';
  end if;

  if new.status is distinct from old.status and not (new.status = any(developer_statuses)) then
    raise exception 'only the security team can move a ticket to %', new.status;
  end if;

  if old.status = 'withdrawn'
    and new.status is distinct from old.status
    and new.status <> 'in_progress' then
    raise exception 'a withdrawn remediation ticket resumes as in_progress';
  end if;

  if new.selected_control_id is distinct from old.selected_control_id then
    if new.type is distinct from 'remediation' then
      raise exception 'only a remediation ticket has a remediation approach';
    end if;
    if not (old.status = any(selectable_from)) then
      raise exception 'the remediation approach cannot be changed once security verification has started';
    end if;
  end if;

  if withdrawing then
    if new.type is distinct from 'remediation' then
      raise exception 'only a remediation ticket can be withdrawn';
    end if;
    if not (old.status = any(withdrawable_from)) then
      raise exception 'a remediation ticket cannot be withdrawn once security verification has started';
    end if;
    if coalesce(btrim(new.withdrawal_reason), '') = '' then
      raise exception 'withdrawing a remediation ticket needs a reason';
    end if;
    if new.withdrawn_by is distinct from auth.uid() then
      raise exception 'the developer withdrawing the ticket must be recorded as withdrawn_by';
    end if;
    if new.withdrawn_at is null then
      raise exception 'withdrawing a remediation ticket must record withdrawn_at';
    end if;
  elsif new.withdrawn_at is distinct from old.withdrawn_at
    or new.withdrawn_by is distinct from old.withdrawn_by
    or new.withdrawal_reason is distinct from old.withdrawal_reason then
    raise exception 'withdrawal details are recorded once, when the ticket is withdrawn';
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
