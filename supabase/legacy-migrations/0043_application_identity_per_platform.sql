-- Makes an application's automation identity its external id together with its
-- platform, so the iOS and Android builds of one app can share an app id and a
-- sync of one platform can never merge into the other's row. Safe to run on a
-- fresh install, whose baseline already has the constraint. See
-- docs/database-maintenance.md#application-identity-per-platform-0043.

alter table applications drop constraint if exists applications_external_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.applications'::regclass
      and conname = 'applications_external_id_platform_key'
  ) then
    alter table applications
      add constraint applications_external_id_platform_key unique (external_id, platform);
  end if;
end $$;
