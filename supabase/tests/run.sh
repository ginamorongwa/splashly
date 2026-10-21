#!/usr/bin/env bash
# Applies the migrations to a scratch Postgres database and runs the scenario
# tests. Needs a local Postgres 15+; set PGHOST/PGPORT/PGUSER as usual.
#   ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=splashly_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/supabase_stub.sql 2> >(grep -v -e wal_level -e "Set wal_level" >&2)
for f in $(ls migrations/*.sql | grep -v scheduled_jobs); do
  psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -d $DB -o /dev/null -f tests/booking_test.sql
