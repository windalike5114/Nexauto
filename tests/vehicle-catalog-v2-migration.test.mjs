import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261006_vehicle_catalog_v2.sql",
  "utf8"
);
const bridgeMigration = readFileSync(
  "supabase/migrations/20261007_nexauto_v2_fitment_bridge.sql",
  "utf8"
);

test("vehicle catalogue V2 has independent canonical identity tables", () => {
  for (const table of [
    "vehicle_makes",
    "vehicle_models",
    "vehicle_generations",
    "vehicle_variants",
    "vehicle_chassis_codes"
  ]) {
    assert.match(migration, new RegExp(`(?:create table if not exists public\\.${table}|references public\\.${table})`, "i"));
  }
});

test("wiper sizes are constrained to approved front and rear inch values", () => {
  assert.match(migration, /position_scope = 'front' and length_in in \(14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30\)/i);
  assert.match(migration, /position_scope = 'rear' and length_in in \(8, 10, 11, 12, 13, 14, 15, 16\)/i);
  assert.match(migration, /foreign key \(size_scope, length_in\)/i);
  assert.match(migration, /wiper_length_fitments_driver_approved_check[\s\S]*not valid/i);
  assert.match(migration, /wiper_rear_addons_approved_check[\s\S]*not valid/i);
});

test("migration preserves provenance, review workflow, and legacy compatibility", () => {
  assert.match(migration, /create table if not exists public\.catalog_source_records/i);
  assert.match(migration, /create table if not exists public\.source_entity_mappings/i);
  assert.match(migration, /create table if not exists public\.fitment_review_queue/i);
  assert.match(migration, /create table if not exists public\.legacy_vehicle_application_map/i);
  assert.match(migration, /add column if not exists vehicle_fitment_application_id/i);
  assert.match(migration, /alias_scope_key text not null default '\*'/i);
  assert.match(migration, /alias_index smallint not null default 0/i);
  assert.match(migration, /unique \(source_record_id, observation_index\)/i);
  assert.match(migration, /configuration_key text not null unique/i);
  assert.match(migration, /function public\.upsert_wiper_configuration/i);
});

test("only published V2 fitments are exposed by public read policies", () => {
  assert.match(migration, /fitment_status = 'published'/i);
  assert.match(migration, /configuration_status = 'published'/i);
});

test("application bridge supports canonical vehicles without weakening publication checks", () => {
  assert.match(bridgeMigration, /save_customer_vehicle_v2/i);
  assert.match(bridgeMigration, /vehicle_fitment_application_id/i);
  assert.match(bridgeMigration, /fitments\.fitment_status = 'published'/i);
  assert.match(bridgeMigration, /configurations\.configuration_status = 'published'/i);
  assert.match(bridgeMigration, /grant execute[\s\S]+to service_role/i);
});
