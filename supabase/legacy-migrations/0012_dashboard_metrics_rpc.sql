-- Aggregated dashboard metrics for the current user's RLS-visible rows.

create or replace function dashboard_metrics() returns jsonb
language sql stable
as $$
  with
  finding_counts as (
    select
      count(*) filter (where status = 'at_risk') as at_risk,
      count(*) filter (where status = 'reduced_risk') as reduced_risk,
      count(*) filter (where status = 'inconclusive') as inconclusive,
      count(*) filter (where severity = 'critical') as critical,
      count(*) filter (where severity = 'high') as high
    from findings
  ),
  ticket_counts as (
    select
      count(*) filter (where status = 'open') as open,
      count(*) filter (where status = 'in_progress') as in_progress,
      count(*) filter (where status = 'fix_submitted') as fix_submitted,
      count(*) filter (where status = 'retest_requested') as retest_requested,
      count(*) filter (where status = 'retest_in_progress') as retest_in_progress,
      count(*) filter (where status = 'under_review') as under_review,
      count(*) filter (where status = 'accepted') as accepted,
      count(*) filter (where status = 'rejected') as rejected,
      count(*) filter (where status = 'closed') as closed,
      count(*) filter (
        where type = 'remediation' and status not in ('closed', 'accepted', 'rejected')
      ) as open_remediation,
      count(*) filter (where type = 'risk_acceptance' and status = 'under_review') as risk_acceptance_pending,
      count(*) filter (where type = 'risk_acceptance' and status = 'accepted') as accepted_risks,
      count(*) filter (where status in ('retest_requested', 'retest_in_progress')) as retest_pending
    from tickets
  ),
  app_counts as (
    select count(*) as applications_count from applications
  ),
  assessment_counts as (
    select
      count(*) as assessments_count,
      count(*) filter (where status = 'running') as assessments_running
    from assessments
  )
  select jsonb_build_object(
    'findingCounts', jsonb_build_object(
      'at_risk', finding_counts.at_risk,
      'reduced_risk', finding_counts.reduced_risk,
      'inconclusive', finding_counts.inconclusive
    ),
    'criticalFindings', finding_counts.critical,
    'highFindings', finding_counts.high,
    'ticketCounts', jsonb_build_object(
      'open', ticket_counts.open,
      'in_progress', ticket_counts.in_progress,
      'fix_submitted', ticket_counts.fix_submitted,
      'retest_requested', ticket_counts.retest_requested,
      'retest_in_progress', ticket_counts.retest_in_progress,
      'under_review', ticket_counts.under_review,
      'accepted', ticket_counts.accepted,
      'rejected', ticket_counts.rejected,
      'closed', ticket_counts.closed
    ),
    'openRemediation', ticket_counts.open_remediation,
    'riskAcceptancePending', ticket_counts.risk_acceptance_pending,
    'acceptedRisks', ticket_counts.accepted_risks,
    'retestPending', ticket_counts.retest_pending,
    'applicationsCount', app_counts.applications_count,
    'assessmentsCount', assessment_counts.assessments_count,
    'assessmentsRunning', assessment_counts.assessments_running
  )
  from finding_counts, ticket_counts, app_counts, assessment_counts;
$$;

grant execute on function dashboard_metrics() to authenticated;
