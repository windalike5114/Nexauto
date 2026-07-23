import test from "node:test";
import assert from "node:assert/strict";
import { validateCheckoutRequest } from "../lib/application/checkout/checkout.adapters";
import { PricingDiscountLineSchema, PricingResultSchema } from "../lib/domain/pricing/pricing.schema";
import { OrderDraftSchema, OrderStatusSchema } from "../lib/domain/orders/order.schema";

const validPayload = {
  items: [
    {
      lineId: "wiper_set|WPFP2418",
      productId: "wiper_set",
      variantId: "set-2418",
      sku: "WPFP2418",
      name: "Premium Front Wiper Blade Pair - 24\" + 18\"",
      category: "wiper",
      qty: 1,
      price: 59.99,
      imageUrl: "/images/wiper.png",
      bundleEligible: true,
      bundleCategory: "front-wiper-pair",
      attributes: {
        vehicle: "Honda Accord 2009",
        vehicle_application_id: "e8122c4c-8844-42cc-bc17-dc7117abd24c",
        vehicle_make: "Honda",
        vehicle_model: "Accord",
        vehicle_year: 2009,
        driver_length: "24\"",
        passenger_length: "18\""
      }
    }
  ],
  couponCode: "SAVE20",
  welcomeRewardApplied: false
};

test("valid cart payload is accepted and adapted to canonical cart", () => {
  const result = validateCheckoutRequest(validPayload);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.cart.items[0].quantity, 1);
  assert.equal(result.data.cart.items[0].product.sku, "WPFP2418");
  assert.equal(result.data.cart.items[0].vehicle?.make, "Honda");
});

test("invalid quantity is rejected", () => {
  const result = validateCheckoutRequest({
    ...validPayload,
    items: [{ ...validPayload.items[0], qty: 0 }]
  });

  assert.equal(result.ok, false);
});

test("missing product identifier is rejected", () => {
  const { productId: _productId, variantId: _variantId, sku: _sku, ...itemWithoutIdentifiers } = validPayload.items[0];
  const result = validateCheckoutRequest({
    ...validPayload,
    items: [itemWithoutIdentifiers]
  });

  assert.equal(result.ok, false);
});

test("modified client price is not copied into canonical cart", () => {
  const result = validateCheckoutRequest({
    ...validPayload,
    items: [{ ...validPayload.items[0], price: 9999 }]
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal("price" in result.data.cart.items[0], false);
});

test("modified client total is ignored by the canonical checkout input", () => {
  const result = validateCheckoutRequest({
    ...validPayload,
    subtotal: 1,
    total: 1,
    grandTotal: 1
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal("total" in result.data.cart, false);
});

test("invalid vehicle context is rejected", () => {
  const result = validateCheckoutRequest({
    ...validPayload,
    items: [
      {
        ...validPayload.items[0],
        attributes: {
          vehicle_make: "Toyota"
        }
      }
    ]
  });

  assert.equal(result.ok, false);
});

test("invalid vehicle application UUID is rejected", () => {
  const result = validateCheckoutRequest({
    ...validPayload,
    items: [
      {
        ...validPayload.items[0],
        attributes: {
          ...validPayload.items[0].attributes,
          vehicle_application_id: "not-a-uuid"
        }
      }
    ]
  });

  assert.equal(result.ok, false);
});

test("blank vehicle application UUID is treated as absent", () => {
  const result = validateCheckoutRequest({
    ...validPayload,
    items: [
      {
        ...validPayload.items[0],
        attributes: {
          ...validPayload.items[0].attributes,
          vehicle_application_id: ""
        }
      }
    ]
  });

  assert.equal(result.ok, true);
});

test("invalid currency is rejected", () => {
  assert.throws(() =>
    PricingResultSchema.parse({
      currency: "usd",
      lines: [],
      productSubtotalMinor: 0,
      discounts: [],
      discountTotalMinor: 0,
      shippingMinor: 0,
      taxIncludedMinor: 0,
      grandTotalMinor: 0
    })
  );
});

test("negative discount is rejected", () => {
  assert.throws(() =>
    PricingDiscountLineSchema.parse({
      type: "coupon",
      label: "Bad discount",
      amountMinor: -1
    })
  );
});

test("invalid order status is rejected", () => {
  assert.throws(() => OrderStatusSchema.parse("shipped"));
});

test("order snapshots survive JSON serialization", () => {
  const draft = OrderDraftSchema.parse({
    customer: {
      email: "customer@example.co.nz",
      name: "Customer"
    },
    items: [
      {
        product: {
          productId: "wiper_set",
          variantId: "set-2418",
          sku: "WPFP2418",
          name: "Premium Front Wiper Blade Pair - 24\" + 18\"",
          category: "wiper",
          attributes: {
            driver_length: "24\"",
            passenger_length: "18\""
          }
        },
        vehicle: {
          applicationId: "e8122c4c-8844-42cc-bc17-dc7117abd24c",
          make: "Honda",
          model: "Accord",
          year: 2009,
          label: "Honda Accord 2009"
        },
        fitment: {
          driverLengthIn: 24,
          passengerLengthIn: 18,
          connectorMatchedBy: "unknown"
        },
        quantity: 1,
        unitAmountMinor: 5999,
        lineTotalMinor: 5999
      }
    ],
    pricing: {
      currency: "nzd",
      lines: [
        {
          productId: "wiper_set",
          variantId: "set-2418",
          sku: "WPFP2418",
          quantity: 1,
          unitAmountMinor: 5999,
          subtotalMinor: 5999,
          discountMinor: 0,
          totalMinor: 5999
        }
      ],
      productSubtotalMinor: 5999,
      discounts: [],
      discountTotalMinor: 0,
      shippingMinor: 0,
      taxIncludedMinor: 782,
      gstIncludedMinor: 782,
      grandTotalMinor: 5999
    },
    vehicle: {
      applicationId: "e8122c4c-8844-42cc-bc17-dc7117abd24c",
      make: "Honda",
      model: "Accord",
      year: 2009,
      label: "Honda Accord 2009"
    },
    currency: "nzd"
  });
  const serialized = JSON.parse(JSON.stringify(draft));

  assert.deepEqual(OrderDraftSchema.parse(serialized), draft);
});

test("existing CartProvider checkout payload remains compatible", () => {
  const result = validateCheckoutRequest(validPayload);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.legacyItems[0].productId, "wiper_set");
  assert.equal(result.data.legacyItems[0].price, 59.99);
});
