import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseCustomerVehicleInput, parseCustomerVehiclePatch, type CustomerVehicleInput, type CustomerVehiclePatch } from "../lib/domain/account/customer-vehicle.schema";
import type { CustomerVehicleRepository } from "../lib/application/account/customer-vehicle-repository";
import { deleteCustomerVehicleForAccount } from "../lib/application/account/delete-customer-vehicle";
import { saveCustomerVehicleForAccount } from "../lib/application/account/save-customer-vehicle";
import { setDefaultCustomerVehicleForAccount } from "../lib/application/account/set-default-customer-vehicle";
import { updateCustomerVehicleForAccount } from "../lib/application/account/update-customer-vehicle";
import type { CustomerVehicle, CustomerVehicleMutationContext } from "../lib/domain/account/customer-vehicle.types";

const context: CustomerVehicleMutationContext = {
  authUserId: "auth-user-1",
  customerProfileId: "profile-1"
};

test("valid saved vehicle input is normalized", () => {
  const parsed = parseCustomerVehicleInput({
    applicationId: "11111111-1111-4111-8111-111111111111",
    year: "2018",
    label: "  Hilux work ute  "
  });
  assert.equal(parsed.year, 2018);
  assert.equal(parsed.label, "Hilux work ute");
  assert.equal(parsed.source, "fitment_lookup");
});

test("saved vehicle input rejects browser ownership fields", () => {
  assert.throws(
    () =>
      parseCustomerVehicleInput({
        applicationId: "11111111-1111-4111-8111-111111111111",
        year: 2018,
        customerProfileId: "profile-2"
      }),
    /customerProfileId cannot be submitted/
  );
});

test("vehicle label patch rejects canonical vehicle fields", () => {
  assert.throws(() => parseCustomerVehiclePatch({ label: "Daily", make: "Toyota" }), /make cannot be changed/);
});

test("first saved vehicle becomes default", async () => {
  const repo = new InMemoryVehicleRepository();
  const vehicle = await saveCustomerVehicleForAccount(context, vehicleInput("11111111-1111-4111-8111-111111111111", 2018), repo);
  assert.equal(vehicle.isDefault, true);
});

test("second saved vehicle does not replace default unless requested", async () => {
  const repo = new InMemoryVehicleRepository();
  const first = await saveCustomerVehicleForAccount(context, vehicleInput("11111111-1111-4111-8111-111111111111", 2018), repo);
  const second = await saveCustomerVehicleForAccount(context, vehicleInput("22222222-2222-4222-8222-222222222222", 2020), repo);
  assert.equal(first.isDefault, true);
  assert.equal(second.isDefault, false);
  assert.equal(repo.vehicles.filter((vehicle) => vehicle.isDefault).length, 1);
});

test("saving the existing default vehicle preserves default status", async () => {
  const repo = new InMemoryVehicleRepository();
  const first = await saveCustomerVehicleForAccount(context, vehicleInput("11111111-1111-4111-8111-111111111111", 2018), repo);
  const savedAgain = await saveCustomerVehicleForAccount(context, vehicleInput("11111111-1111-4111-8111-111111111111", 2018), repo);
  assert.equal(savedAgain.id, first.id);
  assert.equal(savedAgain.isDefault, true);
  assert.equal(repo.vehicles.filter((vehicle) => vehicle.isDefault).length, 1);
});

test("setting default vehicle is atomic at application boundary", async () => {
  const repo = new InMemoryVehicleRepository();
  await saveCustomerVehicleForAccount(context, vehicleInput("11111111-1111-4111-8111-111111111111", 2018), repo);
  const second = await saveCustomerVehicleForAccount(context, vehicleInput("22222222-2222-4222-8222-222222222222", 2020), repo);
  await setDefaultCustomerVehicleForAccount(context, second.id, repo);
  assert.equal(repo.vehicles.find((vehicle) => vehicle.id === second.id)?.isDefault, true);
  assert.equal(repo.vehicles.filter((vehicle) => vehicle.isDefault).length, 1);
});

test("deleting default vehicle deterministically selects replacement", async () => {
  const repo = new InMemoryVehicleRepository();
  const first = await saveCustomerVehicleForAccount(context, vehicleInput("11111111-1111-4111-8111-111111111111", 2018), repo);
  const second = await saveCustomerVehicleForAccount(context, vehicleInput("22222222-2222-4222-8222-222222222222", 2020), repo);
  await setDefaultCustomerVehicleForAccount(context, second.id, repo);
  const result = await deleteCustomerVehicleForAccount(context, second.id, repo);
  assert.equal(result.deletedVehicleId, second.id);
  assert.equal(result.replacementDefaultVehicleId, first.id);
  assert.equal(repo.vehicles.length, 1);
  assert.equal(repo.vehicles[0].isDefault, true);
});

test("vehicle label can be updated without changing canonical vehicle identity", async () => {
  const repo = new InMemoryVehicleRepository();
  const vehicle = await saveCustomerVehicleForAccount(context, vehicleInput("11111111-1111-4111-8111-111111111111", 2018), repo);
  const updated = await updateCustomerVehicleForAccount(context, vehicle.id, { label: "Family car" }, repo);
  assert.equal(updated.label, "Family car");
  assert.equal(updated.applicationId, vehicle.applicationId);
  assert.equal(updated.year, 2018);
});

test("customer vehicle migration contains RPC/RLS/default hardening", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260723_customer_vehicles_stabilisation.sql"), "utf8");
  const rlsSql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260723_customer_vehicles_rls_hardening.sql"), "utf8");
  assert.match(sql, /add column if not exists is_default boolean not null default false/i);
  assert.match(sql, /customer_vehicles_one_default_uidx/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /vehicle_application_not_found/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /revoke all on function public\.save_customer_vehicle[\s\S]+from authenticated/i);
  assert.match(sql, /grant execute on function public\.delete_customer_vehicle[\s\S]+to service_role/i);
  assert.match(sql, /public\.customer_profile_belongs_to_auth_user\(customer_profile_id, auth\.uid\(\)\)/i);
  assert.match(rlsSql, /alter table public\.customer_vehicles enable row level security/i);
  assert.match(rlsSql, /revoke all on table public\.customer_vehicles from anon/i);
  assert.match(rlsSql, /to authenticated/i);
});

function vehicleInput(applicationId: string, year: number): CustomerVehicleInput {
  return {
    applicationId,
    year,
    label: null,
    source: "fitment_lookup",
    isDefault: false
  };
}

class InMemoryVehicleRepository implements CustomerVehicleRepository {
  vehicles: CustomerVehicle[] = [];
  private sequence = 0;

  async save(_context: CustomerVehicleMutationContext, input: CustomerVehicleInput) {
    const existing = this.vehicles.find((vehicle) => vehicle.applicationId === input.applicationId && vehicle.year === input.year);
    const shouldDefault = input.isDefault || this.vehicles.length === 0;
    if (shouldDefault) this.vehicles = this.vehicles.map((vehicle) => ({ ...vehicle, isDefault: false }));

    const next: CustomerVehicle = {
      id: existing?.id ?? `vehicle-${++this.sequence}`,
      applicationId: input.applicationId,
      label: input.label,
      make: input.applicationId.startsWith("1") ? "Toyota" : "Lexus",
      model: input.applicationId.startsWith("1") ? "Hilux" : "GS250",
      year: input.year,
      source: input.source,
      isDefault: shouldDefault || existing?.isDefault === true,
      lastUsedAt: new Date(this.sequence * 1000).toISOString()
    };

    this.vehicles = existing ? this.vehicles.map((vehicle) => (vehicle.id === existing.id ? next : vehicle)) : [...this.vehicles, next];
    return next;
  }

  async update(_context: CustomerVehicleMutationContext, vehicleId: string, input: CustomerVehiclePatch) {
    const vehicle = this.vehicles.find((entry) => entry.id === vehicleId);
    assert.ok(vehicle);
    const updated = { ...vehicle, label: input.label };
    this.vehicles = this.vehicles.map((entry) => (entry.id === vehicleId ? updated : entry));
    return updated;
  }

  async delete(_context: CustomerVehicleMutationContext, vehicleId: string) {
    const target = this.vehicles.find((vehicle) => vehicle.id === vehicleId);
    assert.ok(target);
    this.vehicles = this.vehicles.filter((vehicle) => vehicle.id !== vehicleId);
    let replacementDefaultVehicleId: string | null = null;
    if (target.isDefault && this.vehicles.length) {
      replacementDefaultVehicleId = this.vehicles[0].id;
      this.vehicles[0] = { ...this.vehicles[0], isDefault: true };
    }
    return { deletedVehicleId: vehicleId, replacementDefaultVehicleId };
  }

  async setDefault(_context: CustomerVehicleMutationContext, vehicleId: string) {
    this.vehicles = this.vehicles.map((vehicle) => ({ ...vehicle, isDefault: vehicle.id === vehicleId }));
    const vehicle = this.vehicles.find((entry) => entry.id === vehicleId);
    assert.ok(vehicle);
    return vehicle;
  }
}
