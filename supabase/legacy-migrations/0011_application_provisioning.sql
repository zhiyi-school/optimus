-- Provisioning state mirrored from the automation backend. NULL means the
-- backend isn't tracking this app. See docs/AUTOMATION_API.md#app-provisioning.

alter table applications
  add column provisioning_status text
    check (provisioning_status in ('pending', 'ready', 'failed')),
  add column provisioning_error text;
