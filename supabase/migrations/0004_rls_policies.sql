-- Fresh-install baseline: row-level security on every table and its policies.
-- See docs/roles-and-workflows.md for the role and team scoping these enforce.

alter table teams enable row level security;
alter table profiles enable row level security;
alter table applications enable row level security;
alter table assessments enable row level security;
alter table findings enable row level security;
alter table finding_history enable row level security;
alter table risk_conversations enable row level security;
alter table tickets enable row level security;
alter table risk_conversation_entries enable row level security;
alter table risk_conversation_attachments enable row level security;
alter table ticket_controls enable row level security;
alter table ticket_control_steps enable row level security;
alter table evidence enable row level security;
alter table retest_runs enable row level security;
alter table risk_acceptance enable row level security;
alter table activity_log enable row level security;
alter table assessment_run_requests enable row level security;

create policy teams_select on teams for select to authenticated using (true);
create policy teams_write on teams for insert to authenticated
  with check (has_role('admin'));
create policy teams_update on teams for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- Role and id changes are further restricted by prevent_role_escalation().
create policy profiles_select on profiles for select to authenticated using (true);
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_by_admin on profiles for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));

create policy applications_select on applications for select to authenticated
  using (can_access_application(id));
create policy applications_write on applications for insert to authenticated
  with check (has_role('security') or has_role('admin'));
create policy applications_update on applications for update to authenticated
  using (has_role('security') or has_role('admin'))
  with check (has_role('security') or has_role('admin'));
create policy applications_delete on applications for delete to authenticated
  using (has_role('security') or has_role('admin'));

create policy assessments_select on assessments for select to authenticated
  using (can_access_application(application_id));
create policy assessments_write on assessments for insert to authenticated
  with check (has_role('security'));
create policy assessments_update on assessments for update to authenticated
  using (has_role('security')) with check (has_role('security'));

create policy findings_select on findings for select to authenticated
  using (can_access_application(application_id));
create policy findings_write on findings for insert to authenticated
  with check (has_role('security'));
create policy findings_update on findings for update to authenticated
  using (has_role('security')) with check (has_role('security'));

create policy finding_history_select on finding_history for select to authenticated
  using (exists (
    select 1 from findings
    where findings.id = finding_history.finding_id
      and can_access_application(findings.application_id)
  ));
create policy finding_history_write on finding_history for insert to authenticated
  with check (has_role('security'));

create policy risk_conversations_select on risk_conversations for select to authenticated
  using (can_access_application(application_id));
create policy risk_conversations_insert on risk_conversations for insert to authenticated
  with check ((has_role('developer') or has_role('security')) and can_access_application(application_id));
create policy risk_conversations_update on risk_conversations for update to authenticated
  using ((has_role('developer') or has_role('security')) and can_access_application(application_id))
  with check ((has_role('developer') or has_role('security')) and can_access_application(application_id));

-- Developer status changes are further restricted by enforce_ticket_update_permissions().
create policy tickets_select on tickets for select to authenticated
  using (can_access_application(application_id));
create policy tickets_insert on tickets for insert to authenticated
  with check (
    created_by = auth.uid()
    and (has_role('security') or (has_role('developer') and can_access_application(application_id)))
  );
create policy tickets_update on tickets for update to authenticated
  using (has_role('security') or (has_role('developer') and can_access_application(application_id)))
  with check (has_role('security') or (has_role('developer') and can_access_application(application_id)));

-- Entries are append-only. Workflow events other than these are written by security-definer functions.
create policy risk_conversation_entries_select on risk_conversation_entries for select to authenticated
  using (can_access_risk_conversation(conversation_id));
create policy risk_conversation_entries_insert on risk_conversation_entries for insert to authenticated
  with check (
    can_access_risk_conversation(conversation_id)
    and author_id = auth.uid()
    and (
      (kind in ('message', 'retest_requested', 'remediation_started', 'remediation_withdrawn')
        and (has_role('developer') or has_role('security')))
      or (kind in ('classification_changed', 'retest_started', 'retest_completed', 'retest_failed')
        and has_role('security'))
    )
  );

create policy risk_conversation_attachments_select on risk_conversation_attachments for select to authenticated
  using (exists (
    select 1 from risk_conversation_entries e
    where e.id = risk_conversation_attachments.entry_id
      and can_access_risk_conversation(e.conversation_id)
  ));
create policy risk_conversation_attachments_insert on risk_conversation_attachments for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and (has_role('developer') or has_role('security'))
    and exists (
      select 1 from risk_conversation_entries e
      where e.id = risk_conversation_attachments.entry_id
        and can_access_risk_conversation(e.conversation_id)
    )
  );

create policy ticket_controls_select on ticket_controls for select to authenticated
  using (can_access_ticket(ticket_id));
create policy ticket_controls_insert on ticket_controls for insert to authenticated
  with check (
    (has_role('developer') or has_role('security'))
    and can_access_ticket(ticket_id)
    and (completed_by is null or completed_by = auth.uid())
  );
create policy ticket_controls_update on ticket_controls for update to authenticated
  using ((has_role('developer') or has_role('security')) and can_access_ticket(ticket_id))
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
  using ((has_role('developer') or has_role('security')) and can_access_ticket_control(ticket_control_id))
  with check (
    (has_role('developer') or has_role('security'))
    and can_access_ticket_control(ticket_control_id)
    and (completed_by is null or completed_by = auth.uid())
  );

create policy evidence_select on evidence for select to authenticated
  using (
    (finding_id is not null and exists (
      select 1 from findings
      where findings.id = evidence.finding_id
        and can_access_application(findings.application_id)
    ))
    or (ticket_id is not null and can_access_ticket(ticket_id))
  );
create policy evidence_insert on evidence for insert to authenticated
  with check (
    (has_role('developer') or has_role('security'))
    and (
      (finding_id is not null and exists (
        select 1 from findings
        where findings.id = evidence.finding_id
          and can_access_application(findings.application_id)
      ))
      or (ticket_id is not null and can_access_ticket(ticket_id))
    )
  );

-- Request validation beyond access is enforced by enforce_retest_request_permissions().
create policy retest_runs_select on retest_runs for select to authenticated
  using (
    (ticket_id is not null and can_access_ticket(ticket_id))
    or (conversation_id is not null and can_access_risk_conversation(conversation_id))
  );
create policy retest_runs_insert on retest_runs for insert to authenticated
  with check (
    requested_by = auth.uid()
    and (has_role('developer') or has_role('security'))
    and (
      (ticket_id is not null and can_access_ticket(ticket_id))
      or (ticket_id is null and conversation_id is not null and can_access_risk_conversation(conversation_id))
    )
  );
create policy retest_runs_update on retest_runs for update to authenticated
  using (has_role('security')) with check (has_role('security'));

create policy risk_acceptance_select on risk_acceptance for select to authenticated
  using (can_access_ticket(ticket_id));
create policy risk_acceptance_insert on risk_acceptance for insert to authenticated
  with check (
    requested_by = auth.uid()
    and (has_role('developer') or has_role('security'))
    and can_access_ticket(ticket_id)
  );
create policy risk_acceptance_update on risk_acceptance for update to authenticated
  using (has_role('security')) with check (has_role('security'));

create policy activity_log_select on activity_log for select to authenticated using (true);
create policy activity_log_insert on activity_log for insert to authenticated
  with check (actor_id = auth.uid() or actor_id is null);

-- Clients only read run requests; the RPCs and the worker write them.
create policy assessment_run_requests_select on assessment_run_requests for select to authenticated
  using (can_access_assessment(assessment_id));
