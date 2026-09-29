-- Backend-owned application icons, referenced from here but never stored here.
--
-- The automation backend owns the IPA/APK and the extracted PNG. This table
-- keeps only a logical reference of the form `icons/<sha256>.png` plus the
-- checksum of the build it came from, so the dashboard can tell whether an icon
-- exists before it asks the backend for one. NULL means no icon is known, which
-- is the correct state for every application that existed before this migration.
--
-- See docs/data-model.md#application-icons and docs/automation-api.md#application-icons.

alter table applications
  add column artifact_sha256 text
    check (artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$'),
  add column icon_ref text
    check (icon_ref is null or icon_ref ~ '^icons/[0-9a-f]{64}\.png$'),
  add column icon_extraction_status text
    check (icon_extraction_status in ('available', 'unavailable', 'failed'));
