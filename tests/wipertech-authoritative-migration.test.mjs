import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261025_wipertech_authoritative_lengths.sql", "utf8");
const commerceMigration = readFileSync("supabase/migrations/20261026_wiper_commerce_extended_front_lengths.sql", "utf8");

test("fitment length storage accepts credible source sizes without widening product tables", () => {
  assert.match(migration, /wiper_sizes_source_lengths_check[\s\S]*length_in between 5 and 40/i);
  assert.doesNotMatch(migration, /alter table public\.wiper_sets/i);
  assert.doesNotMatch(migration, /alter table public\.wiper_rear_addons/i);
  assert.match(migration, /create table if not exists public\.wipertech_length_observations/i);
  assert.match(migration, /wipertech_length_observations_driver_check[\s\S]*between 5 and 40/i);
  assert.match(migration, /wipertech_length_observations_rear_check[\s\S]*between 5 and 40/i);
  assert.match(migration, /unique \(source_file_hash, source_row_number\)/i);
  assert.match(migration, /enable row level security/i);
});

test("partial configuration RPC stores only positions supplied by the source", () => {
  assert.match(migration, /upsert_partial_wiper_configuration/i);
  assert.match(migration, /num_nonnulls\(p_driver_length_in, p_passenger_length_in, p_rear_length_in\) = 0/i);
  assert.match(migration, /select distinct position_scope, length_in, true/i);
  assert.match(migration, /where length_in is not null/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
});

test("cross-reviewed product pairs extend only the approved front commerce sizes", () => {
  assert.match(commerceMigration, /alter table public\.wiper_sets/i);
  assert.match(commerceMigration, /wiper_sets_driver_approved_check/i);
  assert.match(commerceMigration, /wiper_sets_passenger_approved_check/i);
  assert.match(commerceMigration, /12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 30/i);
  assert.doesNotMatch(commerceMigration, /wiper_rear_addons/i);
  assert.doesNotMatch(commerceMigration, /between 5 and 40/i);
});
