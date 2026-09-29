-- Fresh-install baseline: private storage buckets and their object policies.
-- ticket-attachments holds conversation attachments under `conversation-<id>/`.

insert into storage.buckets (id, name, public)
values
  ('ticket-attachments', 'ticket-attachments', false),
  ('evidence', 'evidence', false)
on conflict (id) do nothing;

create policy ticket_attachments_object_select on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and can_access_attachment_object(name));
create policy ticket_attachments_object_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and (has_role('developer') or has_role('security'))
    and can_access_attachment_object(name)
  );

create policy evidence_object_select on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and can_access_evidence_object(name));
create policy evidence_object_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and (has_role('developer') or has_role('security'))
    and can_access_evidence_object(name)
  );
