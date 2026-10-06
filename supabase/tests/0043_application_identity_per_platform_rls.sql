-- Application identity checks (fix 0043).
--
-- Paste this whole file into the Supabase SQL Editor and run it as the project
-- owner. It creates its own fixtures and ends with `rollback`, so nothing is
-- left behind. A failed assertion raises and aborts; a clean run prints
-- "0043 application identity checks passed". All identifiers are placeholders.

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
  ('a0000000-0000-0000-0000-00000000000a', 'example_app', 'Example Application', 'ios'),
  ('a0000000-0000-0000-0000-00000000000b', 'example_app', 'Example Application', 'android');

select pg_temp.assert(
  (select count(*) from applications where external_id = 'example_app') = 2,
  'the iOS and Android builds of one app share an external id'
);

do $$
begin
  insert into applications (external_id, name, platform)
  values ('example_app', 'Example Application', 'android');
  raise exception 'FAILED: a second android application with the same external id was accepted';
exception when unique_violation then
  raise notice 'ok: a second application on the same platform with the same external id is refused';
end $$;

insert into applications (external_id, name, platform)
values ('example_app', 'Example Application Renamed', 'android')
on conflict (external_id, platform) do update set name = excluded.name;

select pg_temp.assert(
  (select name from applications where id = 'a0000000-0000-0000-0000-00000000000b') = 'Example Application Renamed'
    and (select name from applications where id = 'a0000000-0000-0000-0000-00000000000a') = 'Example Application'
    and (select platform from applications where id = 'a0000000-0000-0000-0000-00000000000a') = 'ios',
  'an upsert on external id and platform updates only the row on that platform'
);

insert into applications (external_id, name, platform) values
  (null, 'Unlinked Application', 'ios'),
  (null, 'Unlinked Application', 'ios');

select pg_temp.assert(
  (select count(*) from applications where external_id is null and name = 'Unlinked Application') = 2,
  'applications without an external id are not constrained'
);

do $$ begin raise notice '0043 application identity checks passed'; end $$;

rollback;
