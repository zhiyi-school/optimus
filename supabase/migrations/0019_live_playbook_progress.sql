-- Drop the playbook snapshot a ticket used to carry.
--
-- 0017 copied the control title, step count, ordering, step titles and the
-- playbook revision into the ticket, which meant a ticket kept following the
-- version of the playbook it was opened against. The automation backend is the
-- single source of truth for that content and serves it live, so these columns
-- are removed rather than kept in sync.
--
-- What stays is workflow only: which control and which stable step id, whether
-- it is required, its progress status, who completed it and when, and the
-- developer's own note. Progress is matched to the playbook by `control_id` and
-- `step_key`; ordering, titles and step text all come from the backend.
--
-- Existing progress rows are untouched — no status, note or timestamp is lost.
-- A row whose control or step has since left the playbook simply stops being
-- rendered and stops counting toward completion.

alter table ticket_controls
  drop column playbook_revision,
  drop column title,
  drop column step_count,
  drop column position;

alter table ticket_control_steps
  drop column step_title,
  drop column step_index;
