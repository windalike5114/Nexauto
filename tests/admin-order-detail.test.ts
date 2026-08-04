import assert from "node:assert/strict";
import test from "node:test";
import { getAdminOrderDetail, mapPricing } from "../lib/application/admin/get-admin-order-detail";
import type {
  AdminOrderDetailFulfilmentRow,
  AdminOrderDetailItemRow,
  AdminOrderDetailRepository,
  AdminOrderDetailRepositoryResult,
  AdminOrderDetailVehicleSnapshotRow
} from "../lib/application/admin/admin-order-detail.types";
import type { AdminAccessContext } from "../lib/domain/admin/admin-access.types";

const admin: AdminAccessContext = { authUserId: "admin-1", email: "owner@nexautoparts.co.nz", role: "admin" };
const orderId = "11111111-1111-4111-8111-111111111111";

test("invalid order id is rejected before repository access", async () => {
  const repo = new FakeOrderDetailRepository();
  await assert.rejects(() => getAdminOrderDetail("not-an-id", admin, repo), /valid order ID/);
  assert.equal(repo.calls, 0);
});

test("order not found returns a deterministic domain error", async () => {
  const repo = new FakeOrderDetailRepository({ order: null });
  await assert.rejects(() => getAdminOrderDetail(orderId, admin, repo), /Order was not found/);
});

test("orders.order_number is authoritative over legacy snapshot fallback", async () => {
  const detail = await getAdminOrderDetail(orderId, admin, new FakeOrderDetailRepository());
  assert.equal(detail.identity.orderNumber, "NEX00042");
  assert.equal(detail.identity.orderNumberSource, "order_number");
});

test("legacy order number fallback is explicit", async () => {
  const repo = new FakeOrderDetailRepository({
    order: { ...baseOrder(), orderNumber: null, legacyOrderNumber: "NEX99999" }
  });
  const detail = await getAdminOrderDetail(orderId, admin, repo);
  assert.equal(detail.identity.orderNumber, "NEX99999");
  assert.equal(detail.identity.orderNumberSource, "legacy_fallback");
});

test("multiple items, vehicles, and fulfilments are preserved", async () => {
  const detail = await getAdminOrderDetail(orderId, admin, new FakeOrderDetailRepository());
  assert.equal(detail.items.length, 2);
  assert.equal(detail.vehicleSnapshots.length, 2);
  assert.equal(detail.fulfilments.length, 2);
  assert.deepEqual(detail.items.map((item) => item.sku), ["WPFP2418", "H11-BUNDLE"]);
});

test("canonical pricing snapshot is preferred and reconciled", async () => {
  const detail = await getAdminOrderDetail(orderId, admin, new FakeOrderDetailRepository());
  assert.equal(detail.pricing.source, "pricing_snapshot");
  assert.equal(detail.pricing.productSubtotal, 119.98);
  assert.equal(detail.pricing.bundleDiscount, 9.99);
  assert.equal(detail.pricing.welcomeRewardDiscount, 10);
  assert.equal(detail.pricing.couponDiscount, 5);
  assert.equal(detail.pricing.shipping, 0);
  assert.equal(detail.pricing.gstIncluded, 12.39);
  assert.equal(detail.pricing.grandTotal, 94.99);
  assert.equal(detail.pricing.invariant.matches, true);
});

test("legacy pricing fallback does not use current product prices", () => {
  const pricing = mapPricing(
    {
      currency: "nzd",
      subtotal: 59.99,
      pricingSnapshot: null,
      itemsSnapshot: {
        pricing: {
          productsSubtotal: 79.99,
          bundleDiscount: 20,
          finalSubtotal: 59.99,
          shipping: 0
        }
      }
    },
    [item({ unitPrice: 999, lineTotal: 999 })]
  );

  assert.equal(pricing.source, "items_snapshot");
  assert.equal(pricing.productSubtotal, 79.99);
  assert.equal(pricing.grandTotal, 59.99);
});

test("pricing invariant mismatch creates a warning without changing totals", async () => {
  const repo = new FakeOrderDetailRepository({
    order: {
      ...baseOrder(),
      pricingSnapshot: {
        currency: "nzd",
        productSubtotalMinor: 10000,
        discountTotalMinor: 0,
        bundleDiscountMinor: 0,
        welcomeRewardMinor: 0,
        couponDiscountMinor: 0,
        shippingMinor: 0,
        gstIncludedMinor: 1304,
        grandTotalMinor: 9000
      }
    }
  });
  const detail = await getAdminOrderDetail(orderId, admin, repo);
  assert.equal(detail.pricing.grandTotal, 90);
  assert.equal(detail.warnings.some((warning) => warning.code === "pricing_invariant_mismatch"), true);
});

test("front-pair warning requirements exclude non-wiper products", async () => {
  const repo = new FakeOrderDetailRepository({
    fulfilments: [fulfilment({ driverConnector: null, passengerConnector: null })]
  });
  const detail = await getAdminOrderDetail(orderId, admin, repo);
  const codes = detail.warnings.map((warning) => warning.code);
  assert.equal(codes.includes("missing_driver_connector"), true);
  assert.equal(codes.includes("missing_passenger_connector"), true);
  assert.equal(detail.warnings.some((warning) => warning.relatedItemId === "item-bulb"), false);
});

test("rear-only fulfilment does not require front lengths or connectors", async () => {
  const repo = new FakeOrderDetailRepository({
    items: [item({ id: "rear-item", sku: "REAR14", productId: "wiper_rear_addon", wiperSetId: null })],
    fulfilments: [
      fulfilment({
        id: "rear-fulfilment",
        orderItemId: "rear-item",
        wiperSetId: null,
        driverLengthIn: null,
        passengerLengthIn: null,
        rearLengthIn: 14,
        rearConnector: "R1"
      })
    ]
  });
  const detail = await getAdminOrderDetail(orderId, admin, repo);
  assert.equal(detail.warnings.some((warning) => warning.code === "missing_driver_length"), false);
  assert.equal(detail.warnings.some((warning) => warning.code === "missing_passenger_length"), false);
});

test("email and webhook events are associated and sorted by lifecycle timestamps", async () => {
  const detail = await getAdminOrderDetail(orderId, admin, new FakeOrderDetailRepository());
  assert.equal(detail.emailEvents[0]?.status, "delivered");
  assert.equal(detail.emailEvents[0]?.isStableOrderConfirmation, true);
  assert.equal(detail.webhookEvents[0]?.classification, "processed");
  assert.equal(detail.auditTimeline[0]?.timestamp >= detail.auditTimeline[1]?.timestamp, true);
});

test("non-critical section failures keep the main order visible", async () => {
  const repo = new FakeOrderDetailRepository({
    sectionErrors: [{ section: "email", title: "Email unavailable", message: "Could not load email events." }]
  });
  const detail = await getAdminOrderDetail(orderId, admin, repo);
  assert.equal(detail.identity.orderNumber, "NEX00042");
  assert.equal(detail.sectionErrors[0]?.section, "email");
});

class FakeOrderDetailRepository implements AdminOrderDetailRepository {
  calls = 0;
  constructor(private readonly overrides: Partial<AdminOrderDetailRepositoryResult> = {}) {}

  async loadOrderDetail(): Promise<AdminOrderDetailRepositoryResult> {
    this.calls += 1;
    return {
      order: baseOrder(),
      items: [item(), item({ id: "item-bulb", sku: "H11-BUNDLE", productId: "lighting_bundle", wiperSetId: null, productSnapshot: { product_id: "lighting_bundle", category: "lighting" } })],
      vehicleSnapshots: [
        vehicle({ id: "vehicle-1", vehicleApplicationId: "22222222-2222-4222-8222-222222222222" }),
        vehicle({ id: "vehicle-2", make: "Mazda", model: "3", year: 2018, vehicleApplicationId: "33333333-3333-4333-8333-333333333333" })
      ],
      fulfilments: [fulfilment(), fulfilment({ id: "fulfilment-2", orderItemId: null, wiperSetId: null, vehicleApplicationId: null, connectorStatus: "fulfilled" })],
      emailEvents: [
        {
          id: "email-1",
          type: "order_confirmation",
          recipient: "buyer@example.co.nz",
          subject: "Order confirmed",
          status: "sent",
          errorCode: null,
          resendEmailId: "resend-1",
          dedupeKey: `order_confirmation:${orderId}`,
          orderId,
          attemptCount: 1,
          nextRetryAt: null,
          lastErrorSummary: null,
          createdAt: "2026-07-20T00:00:00.000Z",
          sentAt: "2026-07-20T00:01:00.000Z",
          updatedAt: "2026-07-20T00:01:00.000Z"
        },
        {
          id: "email-2",
          type: "order_confirmation",
          recipient: "buyer@example.co.nz",
          subject: "Order confirmed",
          status: "delivered",
          errorCode: null,
          resendEmailId: "resend-1",
          dedupeKey: `order_confirmation:${orderId}`,
          orderId,
          attemptCount: 1,
          nextRetryAt: null,
          lastErrorSummary: null,
          createdAt: "2026-07-20T00:00:00.000Z",
          sentAt: "2026-07-20T00:01:00.000Z",
          updatedAt: "2026-07-20T00:05:00.000Z"
        }
      ],
      webhookEvents: [
        {
          id: "webhook-1",
          stripeEventId: "evt_1",
          eventType: "checkout.session.completed",
          status: "processed",
          attemptCount: 1,
          firstReceivedAt: "2026-07-20T00:02:00.000Z",
          lastAttemptedAt: "2026-07-20T00:02:10.000Z",
          processedAt: "2026-07-20T00:02:20.000Z",
          relatedOrderId: orderId,
          stripeSessionId: "cs_live_1",
          stripePaymentIntentId: "pi_1",
          errorSummary: null,
          retryable: false
        }
      ],
      auditEvents: [
        {
          id: "audit-1",
          eventType: "order_finalised",
          entityType: "order",
          entityId: orderId,
          actorType: "system",
          actorId: null,
          summary: "Order finalised.",
          metadata: {},
          createdAt: "2026-07-20T00:03:00.000Z"
        }
      ],
      sectionErrors: [],
      ...this.overrides
    };
  }
}

function baseOrder() {
  return {
    id: orderId,
    orderNumber: "NEX00042",
    legacyOrderNumber: "NEX99999",
    email: "buyer@example.co.nz",
    customerName: "Buyer",
    customerProfileId: "profile-1",
    subtotal: 94.99,
    currency: "nzd",
    status: "paid",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:05:00.000Z",
    stripeSessionId: "cs_live_1",
    stripePaymentIntentId: "pi_1",
    shippingAddress: { line1: "1 Queen Street", city: "Auckland", postal_code: "1010", country: "NZ" },
    billingAddress: {},
    itemsSnapshot: { stripe: { invoice_id: "in_1", invoice_url: "https://stripe.example/invoice" } },
    pricingSnapshot: {
      currency: "nzd",
      productSubtotalMinor: 11998,
      discountTotalMinor: 2499,
      bundleDiscountMinor: 999,
      welcomeRewardMinor: 1000,
      couponDiscountMinor: 500,
      shippingMinor: 0,
      gstIncludedMinor: 1239,
      grandTotalMinor: 9499
    },
    rewardState: null
  };
}

function item(overrides: Partial<AdminOrderDetailItemRow> = {}): AdminOrderDetailItemRow {
  return {
    id: "item-1",
    orderId,
    productId: "wiper_set",
    variantId: "44444444-4444-4444-8444-444444444444",
    sku: "WPFP2418",
    productName: "Premium Front Wiper Blade Pair",
    attributes: { driver_length: 24, passenger_length: 18, vehicle_application_id: "22222222-2222-4222-8222-222222222222" },
    qty: 1,
    unitPrice: 59.99,
    lineSubtotal: 59.99,
    lineDiscount: 0,
    lineTotal: 59.99,
    vehicleApplicationId: "22222222-2222-4222-8222-222222222222",
    wiperSetId: "44444444-4444-4444-8444-444444444444",
    sourceLineKey: "line-1",
    vehicleSnapshot: {},
    productSnapshot: { product_id: "wiper_set", category: "wiper" },
    createdAt: "2026-07-20T00:00:00.000Z",
    ...overrides
  };
}

function vehicle(overrides: Partial<AdminOrderDetailVehicleSnapshotRow> = {}): AdminOrderDetailVehicleSnapshotRow {
  return {
    id: "vehicle-1",
    orderId,
    vehicleApplicationId: "22222222-2222-4222-8222-222222222222",
    customerVehicleId: null,
    make: "Toyota",
    model: "Hilux",
    year: 2020,
    startRaw: null,
    endRaw: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    ...overrides
  };
}

function fulfilment(overrides: Partial<AdminOrderDetailFulfilmentRow> = {}): AdminOrderDetailFulfilmentRow {
  return {
    id: "fulfilment-1",
    orderId,
    orderItemId: "item-1",
    vehicleApplicationId: "22222222-2222-4222-8222-222222222222",
    wiperSetId: "44444444-4444-4444-8444-444444444444",
    driverLengthIn: 24,
    passengerLengthIn: 18,
    rearLengthIn: null,
    driverConnector: "A",
    passengerConnector: "A",
    rearConnector: null,
    connectorStatus: "selected",
    adminNote: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides
  };
}
