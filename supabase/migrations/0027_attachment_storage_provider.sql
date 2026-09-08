-- Records where a conversation attachment's bytes live, so a file kept by the
-- automation server and one kept in the private Supabase bucket can coexist.
-- Rows written before this migration are Supabase objects.

alter table risk_conversation_attachments
  add column storage_provider text not null default 'supabase'
    check (storage_provider in ('supabase', 'server')),
  add column size_bytes bigint
    check (size_bytes is null or size_bytes >= 0);

-- storage_path is an opaque key inside its provider, never a host filesystem path.
alter table risk_conversation_attachments
  add constraint risk_conversation_attachments_storage_path_relative
    check (
      storage_path <> ''
      and storage_path !~ '^/'
      and storage_path !~ '(^|/)\.\.(/|$)'
    );

comment on column risk_conversation_attachments.storage_provider is
  'supabase = object at storage_path in the private ticket-attachments bucket; server = automation-server key at storage_path. Access is decided by can_access_risk_conversation on the owning entry, never by uploaded_by.';

comment on column risk_conversation_attachments.size_bytes is
  'Size of the stored file in bytes, recorded at upload. Null for rows uploaded before this column existed.';
