import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claimCustomerOrdersForAccount } from "../lib/application/account/claim-customer-orders";
import type { CustomerOrderClaimRepository } from "../lib/application/account/customer-order-repository";
import { OrderClaimError } from "../lib/domain/account/order-claim.errors";
import { normalizeClaimEmail } from "../lib/domain/account/order-claim.schema";

const migrationSql = readFileSync("supabase/migrations/20260724_guest_order_claiming.sql", "utf8");
const accountRoute = readFileSync("app/api/account/route.ts", "utf8");
const accountQueries = readFileSync("lib/queries/account.ts", "utf8");

test("email normalization is trim plus lowercase only", () => {
  assert.equal(normalizeClaimEmail("  Buyer+Parts@Example.CO.NZ  "), "buyer+parts@example.co.nz");
});

test("claim service requires a verified account email", async () => {
  const repository: CustomerOrderClaimRepository = {
    async claimVerifiedEmailOrders() {
      throw new Error("should not be called");
    }
  };

  await assert.rejects(
    claimCustomerOrdersForAccount(
      {
        authUserId: "auth-1",
        verifiedEmail: "buyer@example.co.nz",
        emailVerified: false
      },
      repository
    ),
    (error) => error instanceof OrderClaimError && error.code === "ORDER_CLAIM_EMAIL_NOT_VERIFIED"
  );
});

test("claim service passes the exact verified email to repository", async () => {
  let capturedEmail: string | null = null;
  const repository: CustomerOrderClaimRepository = {
    async claimVerifiedEmailOrders(context) {
      capturedEmail = context.verifiedEmail;
      return {
        claimedCount: 5,
        alreadyOwnedCount: 0,
        conflictCount: 0,
        skippedCount: 0,
        claimedOrderIds: ["order-1"]
      };
    }
  };

  const result = await claimCustomerOrdersForAccount(
    {
      authUserId: "auth-1",
      verifiedEmail: "Verified@Example.co.nz",
      emailVerified: true
    },
    repository
  );

  assert.equal(capturedEmail, "Verified@Example.co.nz");
  assert.equal(result.claimedCount, 5);
  assert.equal(result.alreadyOwnedCount, 0);
});

test("migration uses exact verified email instead of boolean-only verification", () => {
  assert.match(migrationSql, /claim_customer_orders_for_verified_user\(\s*p_auth_user_id uuid,\s*p_verified_email text\s*\)/i);
  assert.doesNotMatch(migrationSql, /p_email_confirmed boolean/i);
  assert.match(migrationSql, /v_verified_email := lower\(btrim\(coalesce\(p_verified_email, ''\)\)\)/i);
  assert.match(migrationSql, /if v_verified_email <> v_profile_email then\s+raise exception 'customer_profile_email_mismatch'/i);
});

test("migration captures already-owned count before claiming unowned orders", () => {
  const alreadyOwnedIndex = migrationSql.indexOf("into v_already_owned_count");
  const matchingUnownedIndex = migrationSql.indexOf("with matching_unowned as");

  assert.ok(alreadyOwnedIndex > 0);
  assert.ok(matchingUnownedIndex > alreadyOwnedIndex);
});

test("migration prevents duplicate stable audit rows", () => {
  assert.match(migrationSql, /create unique index if not exists order_claim_events_result_uidx/i);
  assert.match(migrationSql, /where status in \(\s*'claimed',\s*'already_owned',\s*'conflict',\s*'skipped_ineligible'\s*\)/i);
  assert.match(migrationSql, /on conflict do nothing/ig);
});

test("migration preserves audit rows and avoids cascade-delete from orders", () => {
  assert.match(migrationSql, /order_id uuid not null references public\.orders\(id\) on delete restrict/i);
  assert.doesNotMatch(migrationSql, /order_id uuid not null references public\.orders\(id\) on delete cascade/i);
});

test("migration uses a 64-bit advisory lock and verifies orders updated_at exists in schema snapshot", () => {
  assert.match(migrationSql, /hashtextextended\('order_claim:' \|\| v_profile\.id::text,\s*0\)/i);
  assert.match(readFileSync("supabase/schema.sql", "utf8"), /updated_at timestamptz not null default now\(\)/i);
});

test("migration status policy claims paid/refunded and skips pending/failed/cancelled", () => {
  assert.match(migrationSql, /o\.status in \('paid', 'refunded'\)/i);
  assert.match(migrationSql, /o\.status in \('pending', 'failed', 'cancelled'\)/i);
});

test("RPC permissions are service-role only", () => {
  assert.match(migrationSql, /revoke execute on function public\.claim_customer_orders_for_verified_user\(uuid, text\)\s+from public, anon, authenticated/i);
  assert.match(migrationSql, /grant execute on function public\.claim_customer_orders_for_verified_user\(uuid, text\)\s+to service_role/i);
});

test("account route derives claim identity from Supabase user session", () => {
  assert.match(accountRoute, /claimCustomerOrdersForAccount/i);
  assert.match(accountRoute, /authUserId: user\.id/i);
  assert.match(accountRoute, /verifiedEmail: user\.email \?\? null/i);
  assert.match(accountRoute, /emailVerified: Boolean\(user\.email_confirmed_at \?\? user\.confirmed_at\)/i);
  assert.doesNotMatch(accountRoute, /request\.json\(\).*verifiedEmail/s);
});

test("account query prefers customer_profile_id and only falls back to unowned matching paid or refunded email orders", () => {
  assert.match(accountQueries, /listCustomerOrdersForProfile\(profileId: string, emailInput: string\)/i);
  assert.match(accountQueries, /\.eq\("customer_profile_id", profileId\)/i);
  assert.match(accountQueries, /\.is\("customer_profile_id", null\)/i);
  assert.match(accountQueries, /\.in\("status", \["paid", "refunded"\]\)/i);
});
