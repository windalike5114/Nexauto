import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutSession, type CheckoutServiceDependencies, type PendingCheckoutOrderInput } from "../lib/application/checkout/create-checkout-session";
import { buildStripeSessionParams, getStripeLineAmountTotal } from "../lib/infrastructure/stripe/create-checkout-session";
import type { CartItem } from "../lib/types";

const vehicleApplicationId = "e8122c4c-8844-42cc-bc17-dc7117abd24c";

function cartFrontPair(sku = "WPFP2418", vehicle = "Toyota Hilux 2018"): CartItem {
  return {
    productId: "wiper_set",
    variantId: `set-${sku}`,
    sku,
    name: `Client ${sku}`,
    category: "wiper",
    qty: 1,
    price: 1,
    bundleEligible: true,
    bundleCategory: "front-wiper-pair",
    attributes: {
      vehicle,
      vehicle_application_id: vehicleApplicationId,
      vehicle_make: vehicle.split(" ")[0],
      vehicle_model: vehicle.split(" ").slice(1, -1).join(" "),
      vehicle_year: Number(vehicle.split(" ").at(-1)),
      driver_length: "24\"",
      passenger_length: "18\""
    }
  };
}

function trustedFrontPair(item: CartItem): CartItem {
  return {
    ...item,
    name: `Premium Front Wiper Blade Pair ${item.sku}`,
    price: 59.99,
    bundleEligible: true,
    bundleCategory: "front-wiper-pair"
  };
}

function baseDependencies(overrides: Partial<CheckoutServiceDependencies> = {}) {
  const persisted: { pendingOrders: PendingCheckoutOrderInput[]; attached: string[]; failed: string[] } = {
    pendingOrders: [],
    attached: [],
    failed: []
  };
  const dependencies: CheckoutServiceDependencies = {
    products: {
      async loadTrustedCartItems(items) {
        return items.map(trustedFrontPair);
      }
    },
    customers: {
      async hasExistingOrders() {
        return false;
      }
    },
    orders: {
      async createPendingOrder(input) {
        persisted.pendingOrders.push(input);
        return { id: "order-1", orderNumber: "NEX00001" };
      },
      async attachStripeSession(_orderId, stripeSessionId) {
        persisted.attached.push(stripeSessionId);
      },
      async markCheckoutSessionFailed(orderId) {
        persisted.failed.push(orderId);
      }
    },
    coupons: {
      async resolveCoupon(code) {
        if (code === "BAD") return null;
        return code ? { code, label: "NZD 10.00 off", amountOffMinor: 1000 } : null;
      }
    },
    payments: {
      async createCheckoutSession() {
        return { sessionId: "cs_test_1", checkoutUrl: "https://checkout.stripe.test/session" };
      }
    },
    logger: {
      info() {},
      error() {}
    },
    ...overrides
  };

  return { dependencies, persisted };
}

async function runCheckout(dependencies: CheckoutServiceDependencies, overrides: Partial<Parameters<typeof createCheckoutSession>[0]> = {}) {
  return createCheckoutSession(
    {
      checkoutRequestId: "checkout-request-1",
      items: [cartFrontPair()],
      couponCode: undefined,
      welcomeRewardApplied: false,
      customer: {
        email: null
      },
      siteUrl: "https://nexautoparts.co.nz",
      ...overrides
    },
    dependencies
  );
}

test("successful guest checkout returns checkout URL", async () => {
  const { dependencies, persisted } = baseDependencies();
  const result = await runCheckout(dependencies);

  assert.equal(result.checkoutUrl, "https://checkout.stripe.test/session");
  assert.equal(persisted.pendingOrders[0].customerEmail, null);
  assert.equal(persisted.attached[0], "cs_test_1");
});

test("successful authenticated checkout preserves customer email", async () => {
  const { dependencies, persisted } = baseDependencies();
  await runCheckout(dependencies, { customer: { email: "buyer@example.co.nz" } });

  assert.equal(persisted.pendingOrders[0].customerEmail, "buyer@example.co.nz");
});

test("product not found is surfaced as safe product unavailable error", async () => {
  const { dependencies } = baseDependencies({
    products: {
      async loadTrustedCartItems() {
        throw new Error("raw database product error");
      }
    }
  });

  await assert.rejects(() => runCheckout(dependencies), /One or more cart items are no longer available/);
});

test("invalid quantity is rejected by pricing", async () => {
  const { dependencies } = baseDependencies();
  await assert.rejects(() => runCheckout(dependencies, { items: [{ ...cartFrontPair(), qty: 0 }] }), /Pricing failed|quantity/i);
});

test("server price overrides client price", async () => {
  const { dependencies, persisted } = baseDependencies();
  await runCheckout(dependencies, { items: [{ ...cartFrontPair(), price: 9999 }] });

  assert.equal(persisted.pendingOrders[0].pricing.productsSubtotal, 59.99);
});

test("bundle pricing applies for two eligible pairs", async () => {
  const { dependencies, persisted } = baseDependencies();
  await runCheckout(dependencies, { items: [cartFrontPair("WPFP2418"), cartFrontPair("WPFP2418")] });

  assert.equal(persisted.pendingOrders[0].pricing.bundleDiscount, 9.99);
});

test("different pair SKUs qualify for bundle", async () => {
  const { dependencies, persisted } = baseDependencies();
  await runCheckout(dependencies, { items: [cartFrontPair("WPFP2418"), cartFrontPair("WPFP2216")] });

  assert.equal(persisted.pendingOrders[0].pricing.finalSubtotal, 109.99);
});

test("welcome reward eligible applies discount", async () => {
  const { dependencies, persisted } = baseDependencies();
  await runCheckout(dependencies, {
    welcomeRewardApplied: true,
    customer: { email: "new@example.co.nz" }
  });

  assert.equal(persisted.pendingOrders[0].pricing.welcomeRewardDiscount, 10);
});

test("welcome reward not eligible does not apply discount", async () => {
  const { dependencies, persisted } = baseDependencies({
    customers: {
      async hasExistingOrders() {
        return true;
      }
    }
  });
  await runCheckout(dependencies, {
    welcomeRewardApplied: true,
    customer: { email: "old@example.co.nz" }
  });

  assert.equal(persisted.pendingOrders[0].pricing.welcomeRewardDiscount, 0);
});

test("valid coupon applies discount", async () => {
  const { dependencies, persisted } = baseDependencies();
  await runCheckout(dependencies, { couponCode: "SAVE10" });

  assert.equal(persisted.pendingOrders[0].pricing.couponDiscount, 10);
});

test("invalid coupon throws safe coupon error", async () => {
  const { dependencies } = baseDependencies();

  await assert.rejects(() => runCheckout(dependencies, { couponCode: "BAD" }), /Coupon code is not valid/);
});

test("free shipping remains zero", async () => {
  const { dependencies, persisted } = baseDependencies();
  await runCheckout(dependencies);

  assert.equal(persisted.pendingOrders[0].pricing.shipping, 0);
});

test("pending order creation failure stops before Stripe session", async () => {
  let stripeCalled = false;
  const { dependencies } = baseDependencies({
    orders: {
      async createPendingOrder() {
        throw new Error("insert failed");
      },
      async attachStripeSession() {},
      async markCheckoutSessionFailed() {}
    },
    payments: {
      async createCheckoutSession() {
        stripeCalled = true;
        return { sessionId: "cs_test", checkoutUrl: "https://checkout.test" };
      }
    }
  });

  await assert.rejects(() => runCheckout(dependencies), /Pending order creation failed/);
  assert.equal(stripeCalled, false);
});

test("Stripe session creation failure marks pending order failed", async () => {
  const { dependencies, persisted } = baseDependencies({
    payments: {
      async createCheckoutSession() {
        throw new Error("stripe unavailable");
      }
    }
  });

  await assert.rejects(() => runCheckout(dependencies), /Stripe checkout session creation failed/);
  assert.deepEqual(persisted.failed, ["order-1"]);
});

test("Stripe session reference persistence failure is controlled", async () => {
  const { dependencies } = baseDependencies({
    orders: {
      async createPendingOrder(input) {
        return { id: input.checkoutRequestId, orderNumber: "NEX00001" };
      },
      async attachStripeSession() {
        throw new Error("update failed");
      },
      async markCheckoutSessionFailed() {}
    }
  });

  await assert.rejects(() => runCheckout(dependencies), /Could not attach Stripe session/);
});

test("duplicate checkout request uses same checkout request id", async () => {
  const { dependencies } = baseDependencies();
  const first = await runCheckout(dependencies, { checkoutRequestId: "same-request" });
  const second = await runCheckout(dependencies, { checkoutRequestId: "same-request" });

  assert.equal(first.checkoutRequestId, second.checkoutRequestId);
});

test("idempotent retry passes stable request id to payment adapter context", async () => {
  let capturedRequestId = "";
  const { dependencies } = baseDependencies({
    payments: {
      async createCheckoutSession(input) {
        capturedRequestId = input.checkoutRequestId;
        return { sessionId: "cs_test", checkoutUrl: "https://checkout.test" };
      }
    }
  });
  await runCheckout(dependencies, { checkoutRequestId: "retry-1" });

  assert.equal(capturedRequestId, "retry-1");
});

test("canonical order draft preserves product, vehicle, and pricing snapshots", async () => {
  const { dependencies, persisted } = baseDependencies();
  await runCheckout(dependencies);
  const draft = persisted.pendingOrders[0];

  assert.equal(draft.items[0].name, "Premium Front Wiper Blade Pair WPFP2418");
  assert.equal(draft.vehicle?.make, "Toyota");
  assert.equal(draft.pricing.productsSubtotal, 59.99);
  assert.equal(draft.pricing.checkoutVersion, "1E");
  assert.equal(draft.pricing.pricingVersion, "2026-07-v1");
  assert.equal(draft.rewardState.reason, "not_requested");
});

test("reward state records applied welcome reward without trusting client amount", async () => {
  const { dependencies, persisted } = baseDependencies();
  await runCheckout(dependencies, {
    welcomeRewardApplied: true,
    customer: { email: "new@example.co.nz" }
  });

  assert.deepEqual(persisted.pendingOrders[0].rewardState, {
    requested: true,
    eligible: true,
    applied: true,
    amountMinor: 1000,
    reason: "applied"
  });
});

test("Stripe adapter converts PricingResult to matching Stripe amount", async () => {
  let adapterInput: Parameters<typeof buildStripeSessionParams>[0] | null = null;
  const { dependencies } = baseDependencies({
    payments: {
      async createCheckoutSession(input) {
        adapterInput = input;
        return { sessionId: "cs_test", checkoutUrl: "https://checkout.test" };
      }
    }
  });
  await runCheckout(dependencies);
  assert(adapterInput);
  const params = buildStripeSessionParams(adapterInput);

  assert.equal(params.line_items?.[0]?.price_data?.unit_amount, 5999);
  assert.equal(getStripeLineAmountTotal(adapterInput.items), adapterInput.pricing.grandTotalMinor);
});

test("Stripe metadata mapping is stable and compact", async () => {
  let adapterInput: Parameters<typeof buildStripeSessionParams>[0] | null = null;
  const { dependencies } = baseDependencies({
    payments: {
      async createCheckoutSession(input) {
        adapterInput = input;
        return { sessionId: "cs_test", checkoutUrl: "https://checkout.test" };
      }
    }
  });
  await runCheckout(dependencies);
  assert(adapterInput);
  const params = buildStripeSessionParams(adapterInput);

  assert.equal(params.metadata?.order_id, "order-1");
  assert.equal(params.metadata?.order_number, "NEX00001");
  assert.equal(params.metadata?.checkout_request_id, "checkout-request-1");
  assert.equal(params.metadata?.checkout_version, "1E");
  assert.equal(params.metadata?.pricing_version, "2026-07-v1");
  assert.equal("items" in (params.metadata ?? {}), false);
  assert.equal("vehicle" in (params.metadata ?? {}), false);
  assert.equal("products_subtotal" in (params.metadata ?? {}), false);
});
