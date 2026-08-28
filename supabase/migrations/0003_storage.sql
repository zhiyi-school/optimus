-- Storage buckets and policies — see docs/DATABASE.md for the path conventions.

insert into storage.buckets (id, name, public)
values
  ('ticket-attachments', 'ticket-attachments', false),
  ('evidence', 'evidence', false)
on conflict (id) do nothing;

create function can_access_ticket_object(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_ticket(((storage.foldername(object_name))[1])::uuid);
$$;

create policy ticket_attachments_object_select on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and can_access_ticket_object(name));

create policy ticket_attachments_object_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and current_app_role() in ('developer', 'security')
    and can_access_ticket_object(name)
  );

create function can_access_evidence_object(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  folder text := (storage.foldername(object_name))[1];
begin
  if folder like 'finding-%' then
    return exists (
      select 1 from findings
      where id = substring(folder from 9)::uuid
        and can_access_application(application_id)
    );
  elsif folder like 'ticket-%' then
    return can_access_ticket(substring(folder from 8)::uuid);
  end if;
  return false;
end;
$$;

create policy evidence_object_select on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and can_access_evidence_object(name));

create policy evidence_object_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and current_app_role() in ('developer', 'security')
    and can_access_evidence_object(name)
  );
