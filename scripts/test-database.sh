#!/usr/bin/env bash
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

for database in optimus_fresh_test optimus_upgrade_0024_test optimus_grants_compat_test; do
  docker exec "$container" createdb -U postgres "$database"
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "alter database ${database} set client_min_messages = warning" >/dev/null
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" -f /workspace/supabase/test-support/bootstrap.sql >/dev/null
done

# A degraded schema may not expose every optional workflow RPC yet.
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d optimus_grants_compat_test \
  -f /workspace/supabase/migrations/0028_workflow_function_grants.sql >/dev/null

apply_migrations() {
  local database="$1"
  local first="${2:-0001}"
  local last="${3:-9999}"
  local run_versioned_tests="${4:-false}"
  local file name version applied sql_test
  for file in "$repo_root"/supabase/migrations/*.sql; do
    name="$(basename "$file")"
    version="${name%%_*}"
    if [[ "$version" < "$first" || "$version" > "$last" ]]; then continue; fi
    applied="$(docker exec "$container" psql -At -U postgres -d "$database" -c "select count(*) from schema_migrations where version = '${version}'")"
    if [[ "$applied" == "0" ]]; then
      docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" -f "/workspace/supabase/migrations/${name}" >/dev/null
      docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" -c \
        "insert into schema_migrations(version, name) values ('${version}', '${name}')" >/dev/null
      if [[ "$run_versioned_tests" == "true" ]]; then
        if [[ "$version" == "0019" ]]; then
          for sql_test in "$repo_root"/supabase/tests/0017_*.sql; do
            docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" -f "/workspace/supabase/tests/$(basename "$sql_test")" >/dev/null
          done
        elif [[ "$version" == "0020" ]]; then
          :
        elif [[ "$version" == "0021" ]]; then
          for sql_test in "$repo_root"/supabase/tests/0018_*.sql "$repo_root"/supabase/tests/0020_*.sql "$repo_root"/supabase/tests/0021_*.sql; do
            docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" -f "/workspace/supabase/tests/$(basename "$sql_test")" >/dev/null
          done
        elif [[ "$version" > "0019" ]]; then
          for sql_test in "$repo_root"/supabase/tests/${version}_*.sql; do
            docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" -f "/workspace/supabase/tests/$(basename "$sql_test")" >/dev/null
          done
        fi
      fi
    fi
  done
}

apply_migrations optimus_fresh_test 0001 9999 true
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d optimus_fresh_test -f /workspace/supabase/test-support/final_schema_assert.sql >/dev/null

apply_migrations optimus_upgrade_0024_test 0001 0024
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d optimus_upgrade_0024_test -f /workspace/supabase/test-support/upgrade_0024_seed.sql >/dev/null
apply_migrations optimus_upgrade_0024_test 0025
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d optimus_upgrade_0024_test -f /workspace/supabase/test-support/upgrade_0024_assert.sql >/dev/null
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d optimus_upgrade_0024_test -f /workspace/supabase/test-support/final_schema_assert.sql >/dev/null

before="$(docker exec "$container" psql -At -U postgres -d optimus_fresh_test -c 'select count(*) from schema_migrations')"
apply_migrations optimus_fresh_test
after="$(docker exec "$container" psql -At -U postgres -d optimus_fresh_test -c 'select count(*) from schema_migrations')"
[[ "$before" == "$after" ]] || { echo "second migration pass applied unexpected work" >&2; exit 1; }

echo "Database checks passed: fresh 0001-0028, upgrade 0024->0028, degraded grant compatibility, RLS, preservation, and no pending migrations."
