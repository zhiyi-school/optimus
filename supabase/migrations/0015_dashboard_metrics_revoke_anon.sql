-- Finish restricting dashboard_metrics() to signed-in callers.
--
-- 0014 revoked EXECUTE from PUBLIC, which was not sufficient. Supabase sets
-- default privileges on the public schema that grant anon, authenticated, and
-- service_role directly, so creating the function in 0012 gave `anon` its own
-- grant. Revoking PUBLIC leaves that grant in place, and an anon caller could
-- still execute the function after 0014 was applied.
--
-- Row-level security already reduced the anon result to zeros, so this closes a
-- reachability gap rather than a data leak.

revoke execute on function dashboard_metrics() from anon;

grant execute on function dashboard_metrics() to authenticated;
grant execute on function dashboard_metrics() to service_role;
