-- One-off, hand-run cleanup merging duplicate `applications` rows; not a migration, run in the Supabase SQL Editor.

-- STEP 1 — PREVIEW (read-only): duplicate name/platform groups, each keeper (oldest linked row, else oldest) and rows to move.

with duplicate_groups as (
  select lower(name) as name_key, platform, array_agg(id order by created_at) as app_ids
  from applications
  group by lower(name), platform
  having count(*) > 1
),
keepers as (
  select
    dg.name_key,
    dg.platform,
    dg.app_ids,
    coalesce(
      (select a.id from applications a
       where a.id = any(dg.app_ids) and a.external_id is not null
       order by a.created_at limit 1),
      (select a.id from applications a
       where a.id = any(dg.app_ids)
       order by a.created_at limit 1)
    ) as keeper_id
  from duplicate_groups dg
)
select
  a.id as application_id,
  a.name,
  a.platform,
  a.external_id,
  a.created_at,
  k.keeper_id,
  (a.id = k.keeper_id) as is_keeper,
  (select count(*) from assessments where application_id = a.id) as assessment_count,
  (select count(*) from findings where application_id = a.id) as finding_count,
  (select count(*) from tickets where application_id = a.id) as ticket_count
from keepers k
join applications a on a.id = any(k.app_ids)
order by k.name_key, k.platform, is_keeper desc, a.created_at;

-- STEP 2 — MERGE (destructive): uncomment after reviewing Step 1; ROLLBACK instead of COMMIT if anything looks wrong.

-- begin;
--
-- do $$
-- declare
--   dup record;
--   loser uuid;
-- begin
--   for dup in (
--     with duplicate_groups as (
--       select lower(name) as name_key, platform, array_agg(id order by created_at) as app_ids
--       from applications
--       group by lower(name), platform
--       having count(*) > 1
--     )
--     select
--       dg.app_ids,
--       coalesce(
--         (select a.id from applications a
--          where a.id = any(dg.app_ids) and a.external_id is not null
--          order by a.created_at limit 1),
--         (select a.id from applications a
--          where a.id = any(dg.app_ids)
--          order by a.created_at limit 1)
--       ) as keeper_id
--     from duplicate_groups dg
--   )
--   loop
--     foreach loser in array dup.app_ids loop
--       if loser <> dup.keeper_id then
--         update assessments set application_id = dup.keeper_id where application_id = loser;
--         update findings set application_id = dup.keeper_id where application_id = loser;
--         update tickets set application_id = dup.keeper_id where application_id = loser;
--         delete from applications where id = loser;
--       end if;
--     end loop;
--   end loop;
-- end $$;
--
-- commit;
