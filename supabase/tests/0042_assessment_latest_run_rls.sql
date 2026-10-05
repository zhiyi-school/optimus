-- Latest-run checks for assessments (fix 0042).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0042 assessment latest run checks passed". All identifiers are placeholders.

begin;

create or replace function pg_temp.assert(condition boolean, description text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'FAILED: %', description;
  end if;
  raise notice 'ok: %', description;
end;
$$;

insert into applications (id, external_id, name, platform) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app', 'Example Application', 'ios');

insert into assessments (id, external_id, application_id, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'manual::example_app',
   'a0000000-0000-0000-0000-00000000000a', 'queued');

select pg_temp.assert(
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'assessments'
            and column_name = 'latest_run_id' and data_type = 'text' and is_nullable = 'YES'),
  'assessments carry an optional text latest_run_id'
);

select pg_temp.assert(
  (select latest_run_id from assessments where id = 'b0000000-0000-0000-0000-00000000000a') is null,
  'a new assessment has no run applied yet'
);

update assessments set latest_run_id = '2026-01-02_00-00-00'
where id = 'b0000000-0000-0000-0000-00000000000a';

select pg_temp.assert(
  (select latest_run_id from assessments where id = 'b0000000-0000-0000-0000-00000000000a') = '2026-01-02_00-00-00',
  'the sync worker records the run it applied'
);

do $$ begin raise notice '0042 assessment latest run checks passed'; end $$;

rollback;
