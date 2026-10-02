#!/usr/bin/env bash
# Runs the baseline, legacy-chain, upgrade and fix checks against a disposable Docker Postgres container.

set -euo pipefail
shopt -s nullglob

if [[ "${1:-}" != "--docker" ]]; then
  echo "Refusing to touch a database. Pass --docker to create an isolated disposable container." >&2
  exit 2
fi

command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="optimus-db-test-${RANDOM}-$$"
image="${DATABASE_TEST_IMAGE:-postgres:15-alpine}"

# Archived on live projects only; a fresh install never creates them.
legacy_only_objects="drop table ticket_attachments, ticket_messages, assessment_messages;
drop function merge_duplicate_risk_conversations(), place_unlinked_ticket_conversations();"

# Removes the disposable container on exit.
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --detach --name "$container" \
  --label "optimus.disposable-database=true" \
  --env POSTGRES_PASSWORD=test-only \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --mount "type=bind,src=${repo_root},dst=/workspace,readonly" \
  "$image" >/dev/null

ready_count=0
for _ in $(seq 1 80); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    ready_count=$((ready_count + 1))
    if [[ "$ready_count" == "4" ]]; then break; fi
  else
    ready_count=0
  fi
  sleep 0.25
done
docker exec "$container" pg_isready -U postgres >/dev/null

# Runs one SQL file from the checkout against a database.
run_sql() {
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$1" -f "/workspace/$2" >/dev/null
}

# Prints a database's schema in a form that can be compared textually.
dump_schema() {
  docker exec "$container" pg_dump -U postgres -d "$1" --schema-only --no-owner -n public -n storage -n auth \
    | grep -v '^\\\(un\)\?restrict '
}

for database in optimus_baseline_test optimus_baseline_only_test optimus_legacy_test optimus_upgrade_0024_test optimus_grants_compat_test; do
  docker exec "$container" createdb -U postgres "$database"
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "alter database ${database} set client_min_messages = warning" >/dev/null
  run_sql "$database" supabase/test-support/bootstrap.sql
done

# A degraded schema may not expose every optional workflow RPC yet.
run_sql optimus_grants_compat_test supabase/legacy-migrations/0028_workflow_function_grants.sql

# Applies each untracked file of one folder in order and records it in schema_migrations.
# With run_tests=true, runs the SQL tests whose fixtures need exactly that version.
apply_folder() {
  local database="$1" folder="$2"
  local first="${3:-0001}" last="${4:-9999}" run_tests="${5:-false}"
  local file name version applied sql_test
  for file in "$repo_root/supabase/$folder"/*.sql; do
    name="$(basename "$file")"
    version="${name%%_*}"
    if [[ "$version" < "$first" || "$version" > "$last" ]]; then continue; fi
    applied="$(docker exec "$container" psql -At -U postgres -d "$database" -c \
      "select count(*) from schema_migrations where version = '${folder}/${version}'")"
    [[ "$applied" == "0" ]] || continue
    run_sql "$database" "supabase/${folder}/${name}"
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" -c \
      "insert into schema_migrations(version, name) values ('${folder}/${version}', '${name}')" >/dev/null
    [[ "$run_tests" == "true" ]] || continue
    for sql_test in $(legacy_tests_after "$version"); do
      run_sql "$database" "supabase/tests/$sql_test"
    done
  done
}

# Names the SQL tests to run once a legacy migration is applied; 0017 and 0018/0020
# fixtures need the schema that 0019 and 0021 respectively completed.
legacy_tests_after() {
  local version="$1" file
  case "$version" in
    0017|0018|0020) return ;;
    0019) set -- 0017 ;;
    0021) set -- 0018 0020 0021 ;;
    *) set -- "$version" ;;
  esac
  for version in "$@"; do
    for file in "$repo_root"/supabase/tests/legacy/${version}_*.sql "$repo_root"/supabase/tests/${version}_*.sql; do
      echo "${file#"$repo_root"/supabase/tests/}"
    done
  done
}

# Runs every current SQL test against a database at the final schema.
run_current_tests() {
  local sql_test
  for sql_test in "$repo_root"/supabase/tests/*.sql; do
    run_sql "$1" "supabase/tests/$(basename "$sql_test")"
  done
}

# Fresh installation: baseline, then every fix, then the current test suite.
apply_folder optimus_baseline_test migrations
apply_folder optimus_baseline_test fixes
run_current_tests optimus_baseline_test
run_sql optimus_baseline_test supabase/test-support/final_schema_assert.sql

# A fresh installation needs no fix: the baseline alone already carries every one.
apply_folder optimus_baseline_only_test migrations
run_current_tests optimus_baseline_only_test
run_sql optimus_baseline_only_test supabase/test-support/final_schema_assert.sql

# Live projects: the historical chain with its version-specific suites, then every fix.
apply_folder optimus_legacy_test legacy-migrations 0001 9999 true
apply_folder optimus_legacy_test fixes
run_current_tests optimus_legacy_test
run_sql optimus_legacy_test supabase/test-support/final_schema_assert.sql

# Supported upgrade with data: seeded at 0024, then the rest of the chain and every fix.
apply_folder optimus_upgrade_0024_test legacy-migrations 0001 0024
run_sql optimus_upgrade_0024_test supabase/test-support/upgrade_0024_seed.sql
apply_folder optimus_upgrade_0024_test legacy-migrations 0025
apply_folder optimus_upgrade_0024_test fixes
run_sql optimus_upgrade_0024_test supabase/test-support/upgrade_0024_assert.sql
run_sql optimus_upgrade_0024_test supabase/test-support/final_schema_assert.sql

# The baseline must build exactly the schema live projects have, less the archived objects.
docker exec "$container" createdb -U postgres -T optimus_legacy_test optimus_legacy_trimmed_test
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d optimus_legacy_trimmed_test \
  -c "$legacy_only_objects" >/dev/null
if ! diff -u <(dump_schema optimus_legacy_trimmed_test) <(dump_schema optimus_baseline_test); then
  echo "the baseline in supabase/migrations/ does not match the legacy chain plus fixes" >&2
  exit 1
fi

if ! diff -u <(dump_schema optimus_baseline_test) <(dump_schema optimus_baseline_only_test); then
  echo "a fix in supabase/fixes/ is missing from the baseline in supabase/migrations/" >&2
  exit 1
fi

before="$(docker exec "$container" psql -At -U postgres -d optimus_baseline_test -c 'select count(*) from schema_migrations')"
apply_folder optimus_baseline_test migrations
apply_folder optimus_baseline_test fixes
after="$(docker exec "$container" psql -At -U postgres -d optimus_baseline_test -c 'select count(*) from schema_migrations')"
[[ "$before" == "$after" ]] || { echo "second migration pass applied unexpected work" >&2; exit 1; }

echo "Database checks passed: fresh baseline plus fixes, baseline alone, legacy chain plus fixes, upgrade from 0024, schema equivalence, degraded grant compatibility, RLS, preservation, and no pending migrations."
