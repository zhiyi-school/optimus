-- App provisioning tickets: created automatically when Security adds a new
-- app, so the physical/manual step of getting it onto a test device (and
-- registering it with the test Apple ID, for iOS) is tracked before
-- automated testing can start. Unlike every other ticket type, these are
-- not created from an existing finding — nothing has been tested yet — so
-- finding_id must become nullable. RLS needs no changes: every existing
-- ticket policy is already keyed off application_id, not finding_id.

alter table tickets alter column finding_id drop not null;

alter table tickets drop constraint tickets_type_check;
alter table tickets add constraint tickets_type_check
  check (type in ('remediation', 'risk_acceptance', 'retest_request', 'app_provisioning'));
