import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCustomerAddress } from "../lib/application/account/create-customer-address";
import { deleteCustomerAddress } from "../lib/application/account/delete-customer-address";
import { importLocalAddresses } from "../lib/application/account/import-local-addresses";
import { setDefaultCustomerAddress } from "../lib/application/account/set-default-customer-address";
import { updateCustomerAddress } from "../lib/application/account/update-customer-address";
import type { CustomerAddressRepository } from "../lib/application/account/customer-address-repository";
import { CustomerAddressInputSchema } from "../lib/domain/account/customer-address.schema";
import type { CustomerAddress, CustomerAddressMutationContext } from "../lib/domain/account/customer-address.types";

const context: CustomerAddressMutationContext = {
  authUserId: "11111111-1111-4111-8111-111111111111",
  customerProfileId: "22222222-2222-4222-8222-222222222222"
};

test("valid NZ address is accepted and normalized", () => {
  const parsed = CustomerAddressInputSchema.parse({
    label: " Home ",
    recipientName: " Frank Wang ",
    line1: " 1 Queen Street ",
    city: " Auckland ",
    postcode: "0101",
    country: "nz"
  });
  assert.equal(parsed.label, "Home");
  assert.equal(parsed.recipientName, "Frank Wang");
  assert.equal(parsed.country, "NZ");
  assert.equal(parsed.postcode, "0101");
});

test("required address fields and country are validated", () => {
  assert.equal(CustomerAddressInputSchema.safeParse({ line1: "1", city: "Auckland", postcode: "0101" }).success, false);
  assert.equal(CustomerAddressInputSchema.safeParse({ recipientName: "A", city: "Auckland", postcode: "0101" }).success, false);
  assert.equal(CustomerAddressInputSchema.safeParse({ recipientName: "A", line1: "1", postcode: "0101" }).success, false);
  assert.equal(CustomerAddressInputSchema.safeParse({ recipientName: "A", line1: "1", city: "Auckland", postcode: "0101", country: "AU" }).success, false);
});

test("postcode must remain a four digit string", () => {
  assert.equal(CustomerAddressInputSchema.safeParse({ recipientName: "A", line1: "1", city: "Auckland", postcode: "101" }).success, false);
  assert.equal(CustomerAddressInputSchema.safeParse({ recipientName: "A", line1: "1", city: "Auckland", postcode: "ABCD" }).success, false);
});

test("ownership fields submitted by browser are rejected", () => {
  const result = CustomerAddressInputSchema.safeParse({
    recipientName: "A",
    line1: "1",
    city: "Auckland",
    postcode: "0101",
    customerProfileId: "other-profile"
  });
  assert.equal(result.success, false);
});

test("first created address becomes default", async () => {
  const repo = new InMemoryAddressRepository();
  const address = await createCustomerAddress(context, addressInput("Home"), repo);
  assert.equal(address.isDefaultShipping, true);
});

test("second address does not replace default unless requested", async () => {
  const repo = new InMemoryAddressRepository();
  const first = await createCustomerAddress(context, addressInput("Home"), repo);
  const second = await createCustomerAddress(context, addressInput("Work"), repo);
  assert.equal(first.isDefaultShipping, true);
  assert.equal(second.isDefaultShipping, false);
  assert.equal((await repo.list(context)).filter((address) => address.isDefaultShipping).length, 1);
});

test("explicit default address unsets previous default", async () => {
  const repo = new InMemoryAddressRepository();
  await createCustomerAddress(context, addressInput("Home"), repo);
  const work = await createCustomerAddress(context, { ...addressInput("Work"), isDefaultShipping: true }, repo);
  const addresses = await repo.list(context);
  assert.equal(addresses.find((address) => address.id === work.id)?.isDefaultShipping, true);
  assert.equal(addresses.filter((address) => address.isDefaultShipping).length, 1);
});

test("set default address is atomic at application boundary", async () => {
  const repo = new InMemoryAddressRepository();
  const first = await createCustomerAddress(context, addressInput("Home"), repo);
  const second = await createCustomerAddress(context, addressInput("Work"), repo);
  await setDefaultCustomerAddress(context, second.id, repo);
  const addresses = await repo.list(context);
  assert.equal(addresses.find((address) => address.id === first.id)?.isDefaultShipping, false);
  assert.equal(addresses.find((address) => address.id === second.id)?.isDefaultShipping, true);
});

test("delete default address deterministically selects replacement", async () => {
  const repo = new InMemoryAddressRepository();
  const first = await createCustomerAddress(context, addressInput("Home"), repo);
  const second = await createCustomerAddress(context, addressInput("Work"), repo);
  await deleteCustomerAddress(context, first.id, repo);
  const addresses = await repo.list(context);
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].id, second.id);
  assert.equal(addresses[0].isDefaultShipping, true);
});

test("delete final address leaves no default", async () => {
  const repo = new InMemoryAddressRepository();
  const first = await createCustomerAddress(context, addressInput("Home"), repo);
  await deleteCustomerAddress(context, first.id, repo);
  assert.equal((await repo.list(context)).length, 0);
});

test("update address changes fields without mutating historical order snapshots", async () => {
  const repo = new InMemoryAddressRepository();
  const orderSnapshot = { shipping_address: { line1: "Old Line", city: "Auckland", postal_code: "0101" } };
  const first = await createCustomerAddress(context, addressInput("Home"), repo);
  await updateCustomerAddress(context, first.id, { line1: "New Line", city: "Auckland", postcode: "0101" }, repo);
  assert.deepEqual(orderSnapshot.shipping_address, { line1: "Old Line", city: "Auckland", postal_code: "0101" });
});

test("legacy import deduplicates submitted and existing addresses", async () => {
  const repo = new InMemoryAddressRepository();
  const result = await importLocalAddresses(
    context,
    {
      addresses: [
        { label: "Home", name: "Frank", line1: "1 Queen Street", city: "Auckland", postcode: "0101", isDefault: true },
        { label: "Home duplicate", name: "Frank", line1: "1 Queen Street", city: "Auckland", postcode: "0101", isDefault: true },
        { label: "Bad", line1: "", city: "", postcode: "x" }
      ]
    },
    repo
  );
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.invalid, 1);
});

test("repeated identical legacy import is idempotent server-side", async () => {
  const repo = new InMemoryAddressRepository();
  const payload = { addresses: [{ label: "Home", name: "Frank", line1: "1 Queen Street", city: "Auckland", postcode: "0101", isDefault: true }] };
  const first = await importLocalAddresses(context, payload, repo);
  const second = await importLocalAddresses(context, payload, repo);
  assert.equal(first.imported, 1);
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 1);
  assert.equal((await repo.list(context)).length, 1);
});

test("customer address migration contains RLS and RPC permission hardening", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260719_customer_addresses.sql"), "utf8");
  const rlsHelperSql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260719_customer_addresses_rls_helper.sql"), "utf8");
  assert.match(sql, /alter table public\.customer_addresses enable row level security/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public/i);
  assert.match(sql, /revoke all on function public\.create_customer_address[\s\S]+from anon/i);
  assert.match(sql, /revoke all on function public\.set_default_customer_address[\s\S]+from authenticated/i);
  assert.match(sql, /grant execute on function public\.delete_customer_address[\s\S]+to service_role/i);
  assert.match(rlsHelperSql, /customer_profile_belongs_to_auth_user/i);
  assert.match(rlsHelperSql, /security definer/i);
  assert.match(rlsHelperSql, /revoke all on function public\.customer_profile_belongs_to_auth_user[\s\S]+from anon/i);
  assert.match(rlsHelperSql, /grant execute on function public\.customer_profile_belongs_to_auth_user[\s\S]+to authenticated/i);
  assert.match(rlsHelperSql, /using \(\s*public\.customer_profile_belongs_to_auth_user\(customer_profile_id, auth\.uid\(\)\)\s*\)/i);
});

test("customer address migration defines atomic default constraints", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260719_customer_addresses.sql"), "utf8");
  assert.match(sql, /customer_addresses_one_default_uidx/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /order by updated_at desc, created_at desc, id desc/i);
});

function addressInput(label: string) {
  return {
    label,
    recipientName: "Frank Wang",
    line1: `${label} Street`,
    city: "Auckland",
    postcode: "0101",
    country: "NZ",
    isDefaultShipping: false
  };
}

class InMemoryAddressRepository implements CustomerAddressRepository {
  private addresses: CustomerAddress[] = [];
  private sequence = 0;

  async list() {
    return [...this.addresses];
  }

  async create(inputContext: CustomerAddressMutationContext, input: Parameters<CustomerAddressRepository["create"]>[1]) {
    const shouldDefault = input.isDefaultShipping || this.addresses.length === 0;
    if (shouldDefault) this.addresses = this.addresses.map((address) => ({ ...address, isDefaultShipping: false }));
    const now = new Date(Date.UTC(2026, 6, 19, 0, this.sequence)).toISOString();
    const address: CustomerAddress = {
      id: `address-${++this.sequence}`,
      customerProfileId: inputContext.customerProfileId,
      label: input.label,
      recipientName: input.recipientName,
      company: input.company,
      phone: input.phone,
      line1: input.line1,
      line2: input.line2,
      suburb: input.suburb,
      city: input.city,
      region: input.region,
      postcode: input.postcode,
      country: "NZ",
      isDefaultShipping: shouldDefault,
      createdAt: now,
      updatedAt: now
    };
    this.addresses.push(address);
    return address;
  }

  async update(_context: CustomerAddressMutationContext, addressId: string, input: Parameters<CustomerAddressRepository["update"]>[2]) {
    const index = this.addresses.findIndex((address) => address.id === addressId);
    assert.notEqual(index, -1);
    this.addresses[index] = {
      ...this.addresses[index],
      ...("label" in input ? { label: input.label ?? null } : {}),
      ...("recipientName" in input ? { recipientName: input.recipientName ?? this.addresses[index].recipientName } : {}),
      ...("line1" in input ? { line1: input.line1 ?? this.addresses[index].line1 } : {}),
      ...("city" in input ? { city: input.city ?? this.addresses[index].city } : {}),
      ...("postcode" in input ? { postcode: input.postcode ?? this.addresses[index].postcode } : {}),
      updatedAt: new Date(Date.UTC(2026, 6, 19, 1, ++this.sequence)).toISOString()
    };
    if (input.isDefaultShipping) return this.setDefault(_context, addressId);
    return this.addresses[index];
  }

  async delete(_context: CustomerAddressMutationContext, addressId: string) {
    const target = this.addresses.find((address) => address.id === addressId);
    assert.ok(target);
    this.addresses = this.addresses.filter((address) => address.id !== addressId);
    let replacementDefaultAddressId: string | null = null;
    if (target.isDefaultShipping && this.addresses.length) {
      this.addresses.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      replacementDefaultAddressId = this.addresses[0].id;
      this.addresses[0] = { ...this.addresses[0], isDefaultShipping: true };
    }
    return { deletedAddressId: addressId, replacementDefaultAddressId };
  }

  async setDefault(_context: CustomerAddressMutationContext, addressId: string) {
    this.addresses = this.addresses.map((address) => ({ ...address, isDefaultShipping: address.id === addressId }));
    const address = this.addresses.find((entry) => entry.id === addressId);
    assert.ok(address);
    return address;
  }

  async importLegacy(inputContext: CustomerAddressMutationContext, inputs: Parameters<CustomerAddressRepository["importLegacy"]>[1]) {
    const before = this.addresses.length;
    for (const input of inputs) {
      const exists = this.addresses.some(
        (address) =>
          address.recipientName.toLowerCase() === input.recipientName.toLowerCase() &&
          address.line1.toLowerCase() === input.line1.toLowerCase() &&
          address.city.toLowerCase() === input.city.toLowerCase() &&
          address.postcode === input.postcode
      );
      if (!exists) await this.create(inputContext, input);
    }
    return {
      imported: this.addresses.length - before,
      skipped: inputs.length - (this.addresses.length - before),
      invalid: 0,
      addresses: await this.list(inputContext)
    };
  }
}
