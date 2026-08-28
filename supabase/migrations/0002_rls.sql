-- Row Level Security — see docs/DATABASE.md for the design rationale.

create function current_app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create function current_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from profiles where id = auth.uid();
$$;

create function can_access_application(app_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    current_app_role() in ('security', 'cio')
    or exists (
      select 1 from applications
      where id = app_id and developer_team_id = current_team_id()
    );
$$;

create function can_access_ticket(t_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_application(application_id) from tickets where id = t_id;
$$;

alter table teams enable row level security;
alter table profiles enable row level security;
alter table applications enable row level security;
alter table assessments enable row level security;
alter table findings enable row level security;
alter table finding_history enable row level security;
alter table tickets enable row level security;
alter table ticket_messages enable row level security;
alter table ticket_attachments enable row level security;
alter table evidence enable row level security;
alter table retest_runs enable row level security;
alter table risk_acceptance enable row level security;
alter table activity_log enable row level security;

-- teams / profiles

create policy teams_select on teams for select to authenticated using (true);

create policy profiles_select on profiles for select to authenticated using (true);

create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create function prevent_role_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    if new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.id is distinct from old.id then
      raise exception 'role and is_active can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_prevent_role_escalation before update on profiles
  for each row execute function prevent_role_escalation();

-- applications / assessments

create policy applications_select on applications for select to authenticated
  using (can_access_application(id));

create policy applications_write on applications for insert to authenticated
  with check (current_app_role() = 'security');
create policy applications_update on applications for update to authenticated
  using (current_app_role() = 'security')
  with check (current_app_role() = 'security');

create policy assessments_select on assessments for select to authenticated
  using (can_access_application(application_id));

create policy assessments_write on assessments for insert to authenticated
  with check (current_app_role() = 'security');
create policy assessments_update on assessments for update to authenticated
  using (current_app_role() = 'security')
  with check (current_app_role() = 'security');

-- findings / finding_history

create policy findings_select on findings for select to authenticated
  using (can_access_application(application_id));

create policy findings_write on findings for insert to authenticated
  with check (current_app_role() = 'security');
create policy findings_update on findings for update to authenticated
  using (current_app_role() = 'security')
  with check (current_app_role() = 'security');

create policy finding_history_select on finding_history for select to authenticated
  using (
    exists (
      select 1 from findings
      where findings.id = finding_history.finding_id
        and can_access_application(findings.application_id)
    )
  );

create policy finding_history_write on finding_history for insert to authenticated
  with check (current_app_role() = 'security');

-- tickets

create policy tickets_select on tickets for select to authenticated
  using (can_access_application(application_id));

create policy tickets_insert on tickets for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      current_app_role() = 'security'
      or (current_app_role() = 'developer' and can_access_application(application_id))
    )
  );

create policy tickets_update on tickets for update to authenticated
  using (
    current_app_role() = 'security'
    or (current_app_role() = 'developer' and can_access_application(application_id))
  )
  with check (
    current_app_role() = 'security'
    or (current_app_role() = 'developer' and can_access_application(application_id))
  );

-- ticket_messages / ticket_attachments

create policy ticket_messages_select on ticket_messages for select to authenticated
  using (can_access_ticket(ticket_id));

create policy ticket_messages_insert on ticket_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and current_app_role() in ('developer', 'security')
    and can_access_ticket(ticket_id)
  );

create policy ticket_attachments_select on ticket_attachments for select to authenticated
  using (can_access_ticket(ticket_id));

create policy ticket_attachments_insert on ticket_attachments for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and current_app_role() in ('developer', 'security')
    and can_access_ticket(ticket_id)
  );

-- evidence

create policy evidence_select on evidence for select to authenticated
  using (
    (finding_id is not null and exists (
      select 1 from findings where findings.id = evidence.finding_id
        and can_access_application(findings.application_id)
    ))
    or (ticket_id is not null and can_access_ticket(ticket_id))
  );

create policy evidence_insert on evidence for insert to authenticated
  with check (
    current_app_role() in ('developer', 'security')
    and (
      (finding_id is not null and exists (
        select 1 from findings where findings.id = evidence.finding_id
          and can_access_application(findings.application_id)
      ))
      or (ticket_id is not null and can_access_ticket(ticket_id))
    )
  );

-- retest_runs

create policy retest_runs_select on retest_runs for select to authenticated
  using (can_access_ticket(ticket_id));

create policy retest_runs_insert on retest_runs for insert to authenticated
  with check (
    requested_by = auth.uid()
    and current_app_role() in ('developer', 'security')
    and can_access_ticket(ticket_id)
  );

create policy retest_runs_update on retest_runs for update to authenticated
  using (current_app_role() = 'security')
  with check (current_app_role() = 'security');

-- risk_acceptance

create policy risk_acceptance_select on risk_acceptance for select to authenticated
  using (can_access_ticket(ticket_id));

create policy risk_acceptance_insert on risk_acceptance for insert to authenticated
  with check (
    requested_by = auth.uid()
    and current_app_role() in ('developer', 'security')
    and can_access_ticket(ticket_id)
  );

create policy risk_acceptance_update on risk_acceptance for update to authenticated
  using (current_app_role() = 'security')
  with check (current_app_role() = 'security');

-- activity_log (append-only audit trail)

create policy activity_log_select on activity_log for select to authenticated using (true);

create policy activity_log_insert on activity_log for insert to authenticated
  with check (actor_id = auth.uid() or actor_id is null);
