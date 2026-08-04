import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAdminCustomerDetail } from "../lib/application/admin/get-admin-customer-detail";
import type {
  AdminCustomerDetailRepository,
  AdminCustomerDetailRepositoryResult
} from "../lib/application/admin/admin-customer-detail.types";
import type { AdminAccessContext } from "../lib/domain/admin/admin-access.types";

const admin: AdminAccessContext = { authUserId: "admin-1", email: "owner@nexautoparts.co.nz", role: "admin" };
const customerId = "11111111-1111-4111-8111-111111111111";

test("invalid customer profile id is rejected before repository access", async () => {
  const repo = new FakeCustomerDetailRepository();
  await assert.rejects(() => getAdminCustomerDetail("not-a-profile-id", admin, repo), /valid customer profile ID/);
  assert.equal(repo.calls, 0);
});

test("customer detail maps profile, saved vehicles, addresses, orders, and history as read-only data", async () => {
  const detail = await getAdminCustomerDetail(customerId, admin, new FakeCustomerDetailRepository());

  assert.equal(detail.profile.accountType, "registered");
  assert.equal(detail.summary.orderCount, 2);
  assert.equal(detail.summary.totalSpent, 124.98);
  assert.equal(detail.summary.savedVehicleCount, 2);
  assert.equal(detail.summary.addressCount, 1);
  assert.equal(detail.summary.defaultVehicleLabel, "2018 Toyota Hilux");
  assert.equal(detail.orders[0]?.detailUrl, "/admin/orders/order-2");
  assert.equal(detail.vehicles[0]?.displayLabel, "2018 Toyota Hilux");
  assert.equal(detail.vehicleHistory[0]?.orderNumber, "NEX00002");
  assert.equal(detail.vehicleHistory[0]?.orderDetailUrl, "/admin/orders/order-2");
});

test("customer detail page is read-only and links back to order details", () => {
  const source = readFileSync("app/admin/customers/[id]/page.tsx", "utf8");

  assert.match(source, /loadAdminCustomerDetailData/);
  assert.match(source, /href=\{order\.detailUrl as never\}/);
  assert.doesNotMatch(source, /<form/i);
  assert.doesNotMatch(source, /action=\{/);
  assert.doesNotMatch(source, /updateCustomer|deleteCustomer|saveCustomer/i);
});

test("admin customer repository uses service role reads and no customer mutations", () => {
  const source = readFileSync("lib/infrastructure/supabase/admin-customer-detail.repository.ts", "utf8");

  assert.match(source, /createSupabaseAdminClient/);
  assert.match(source, /\.from\("customer_profiles"\)/);
  assert.match(source, /\.from\("customer_vehicles"\)/);
  assert.match(source, /\.from\("customer_addresses"\)/);
  assert.match(source, /\.from\("order_vehicle_snapshots"\)/);
  assert.match(source, /claim_method/);
  assert.doesNotMatch(source, /id,order_id,method,status/);
  assert.doesNotMatch(source, /\.insert\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
  assert.doesNotMatch(source, /\.rpc\(/);
});

class FakeCustomerDetailRepository implements AdminCustomerDetailRepository {
  calls = 0;

  async loadCustomerDetail(): Promise<AdminCustomerDetailRepositoryResult> {
    this.calls += 1;
    return {
      profile: {
        id: customerId,
        authUserId: "auth-user-1",
        email: "buyer@example.co.nz",
        name: "Buyer",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z"
      },
      orders: [
        {
          id: "order-2",
          orderNumber: "NEX00002",
          email: "buyer@example.co.nz",
          customerName: "Buyer",
          subtotal: 64.99,
          currency: "nzd",
          status: "paid",
          createdAt: "2026-07-03T00:00:00.000Z"
        },
        {
          id: "order-1",
          orderNumber: "NEX00001",
          email: "buyer@example.co.nz",
          customerName: "Buyer",
          subtotal: 59.99,
          currency: "nzd",
          status: "fulfilled",
          createdAt: "2026-07-02T00:00:00.000Z"
        }
      ],
      vehicles: [
        {
          id: "vehicle-1",
          applicationId: "22222222-2222-4222-8222-222222222222",
          label: "Work ute",
          make: "Toyota",
          model: "Hilux",
          year: 2018,
          source: "fitment_lookup",
          isDefault: true,
          lastUsedAt: "2026-07-03T00:00:00.000Z",
          createdAt: "2026-07-01T00:00:00.000Z"
        },
        {
          id: "vehicle-2",
          applicationId: "33333333-3333-4333-8333-333333333333",
          label: null,
          make: "Mazda",
          model: "3",
          year: 2020,
          source: "fitment_lookup",
          isDefault: false,
          lastUsedAt: "2026-07-02T00:00:00.000Z",
          createdAt: "2026-07-01T00:00:00.000Z"
        }
      ],
      addresses: [
        {
          id: "address-1",
          label: "Home",
          recipientName: "Buyer",
          company: null,
          phone: "021000000",
          line1: "1 Queen Street",
          line2: null,
          suburb: null,
          city: "Auckland",
          region: "Auckland",
          postcode: "1010",
          country: "NZ",
          isDefaultShipping: true,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z"
        }
      ],
      vehicleSnapshots: [
        {
          id: "snapshot-1",
          orderId: "order-2",
          vehicleApplicationId: "22222222-2222-4222-8222-222222222222",
          customerVehicleId: "vehicle-1",
          make: "Toyota",
          model: "Hilux",
          year: 2018,
          createdAt: "2026-07-03T00:00:00.000Z"
        }
      ],
      claimEvents: [
        {
          id: "claim-1",
          orderId: "order-1",
          method: "email_match",
          status: "claimed",
          createdAt: "2026-07-02T00:00:00.000Z"
        }
      ]
    };
  }
}
