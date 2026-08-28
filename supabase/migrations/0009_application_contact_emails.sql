-- A free-form list of contact emails per application (New Assessment's
-- "Contact Points" step), alongside the existing named owner/developer
-- contact fields — additive, doesn't replace them.

alter table applications add column contact_emails text[] not null default '{}';
