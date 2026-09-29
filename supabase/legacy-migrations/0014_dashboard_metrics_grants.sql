-- Make the dashboard_metrics() grant actually restrict.
--
-- Requires 0012_dashboard_metrics_rpc.sql to have been applied first; this
-- migration errors with "function does not exist" otherwise.
--
-- Incomplete on its own: revoking PUBLIC does not remove the direct grant
-- Supabase's default privileges give `anon`. 0015 finishes the job.
--
-- 0012 granted execute to `authenticated`, but Postgres grants EXECUTE to
-- PUBLIC by default, so `anon` could call it too. Row-level security meant an
-- unauthenticated caller got zeros rather than data, so this was not a leak,
-- but the grant line read as a restriction while granting nothing new.
--
-- set search_path is style here, not security: the function is `language sql
-- stable` and runs as SECURITY INVOKER, so it has no privilege-escalation path
-- of the kind the `security definer` functions guard against.

revoke execute on function dashboard_metrics() from public;
grant execute on function dashboard_metrics() to authenticated;

alter function dashboard_metrics() set search_path = public;
