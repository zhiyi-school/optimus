-- Supports manual application/assessment creation from the dashboard
-- (Security Team only). See docs/DATABASE.md.

alter table applications
  add column app_type text,
  add column owner_name text,
  add column owner_email text,
  add column developer_contact_name text,
  add column developer_contact_email text;
