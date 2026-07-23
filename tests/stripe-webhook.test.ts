import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { processStripeEvent, type StripeWebhookDependencies } from "../lib/application/webhooks/process-stripe-event";
import { constructStripeWebhookEvent } from "../lib/infrastructure/stripe/stripe-webhook.adapter";
import type { FinalisableOrder, FinalisedOrder } from "../lib/application/orders/finalise-paid-order";

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_1",
    object: "checkout.session",
    metadata: { order_id: "order-1", order_number: "NEX00001" },
    payment_status: "paid",
    currency: "nzd",
    amount_total: 5999,
    amount_subtotal: 5999,
    customer_email: "buyer@example.co.nz",
    customer_details: { email: "buyer@example.co.nz", name: "Buyer", address: { country: "NZ" } },
    shipping_details: { address: { country: "NZ" } },
    payment_intent: "pi_test_1",
    invoice: "in_test_1",
    ...overrides
  };
}

function order(overrides: Partial<FinalisableOrder> = {}): FinalisableOrder {
  return {
    id: "order-1",
    email: "buyer@example.co.nz",
    customerName: "Buyer",
    subtotal: 59.99,
    currency: "nzd",
    status: "pending",
    stripeSessionId: "cs_test_1",
    stripePaymentIntentId: null,
    itemsSnapshot: {
      order_number: "NEX00001",
      items: [
        {
          product_id: "wiper_set",
          variant_id: "set-2418",
          sku: "WPFP2418",
          product_name: "Premium Front Wiper Blade Pair",
          attributes: {
            vehicle_application_id: "app-1",
            vehicle_make: "Toyota",
            vehicle_model: "Hilux",
            vehicle_year: 2018,
            driver_length: "24\"",
            passenger_length: "18\"",
            finalisation_line_key: "line-1"
          },
          qty: 1,
          unit_price: 59.99,
          line_total: 59.99,
          source_line_key: "line-1"
        }
      ],
      vehicle: {
        a: "app-1",
        make: "Toyota",
        model: "Hilux",
        year: 2018
      },
      pricing: {
        finalSubtotal: 59.99
      }
    },
    ...overrides
  };
}

function deps(overrides: Partial<StripeWebhookDependencies> = {}) {
  const state = {
    completed: [] as Array<{ status: string; relatedOrderId?: string | null; errorSummary?: string | null }>,
    finaliseCount: 0,
    emailCount: 0,
    enrichmentCount: 0,
    expired: 0,
    failed: 0
  };
  const dependencies: StripeWebhookDependencies = {
    events: {
      async claimEvent() {
        return { claimStatus: "claimed", eventId: "evt-row-1", currentStatus: "processing" };
      },
      async completeEvent(input) {
        state.completed.push(input);
      }
    },
    orders: {
      async findOrderByStripeIdentifiers() {
        return order();
      },
      async finalisePaidOrder(input) {
        state.finaliseCount += 1;
        return {
          orderId: input.order.id,
          orderNumber: "NEX00001",
          email: input.order.email,
          customerName: input.order.customerName,
          subtotal: 59.99,
          total: 59.99,
          currency: "nzd",
          items: input.order.itemsSnapshot.items ?? [],
          vehicle: input.order.itemsSnapshot.vehicle,
          shippingAddress: {},
          billingAddress: {}
        } satisfies FinalisedOrder;
      },
      async markCheckoutExpired() {
        state.expired += 1;
      },
      async markPaymentFailed() {
        state.failed += 1;
      }
    },
    customers: {
      async enrichFromFinalisedOrder() {
        state.enrichmentCount += 1;
      }
    },
    emails: {
      async sendOrderConfirmation() {
        state.emailCount += 1;
        return "sent";
      }
    },
    logger: {
      info() {},
      error() {}
    },
    ...overrides
  };

  return { dependencies, state };
}

function event(type = "checkout.session.completed", object: unknown = session()) {
  return { id: "evt_test_1", type, data: { object } };
}

test("valid signed webhook payload is converted to command", () => {
  const stripe = new Stripe("sk_test_123");
  const payload = JSON.stringify(event());
  const secret = "whsec_test";
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const command = constructStripeWebhookEvent(stripe, payload, header, secret);

  assert.equal(command.id, "evt_test_1");
  assert.equal(command.type, "checkout.session.completed");
});

test("invalid signature is rejected", () => {
  const stripe = new Stripe("sk_test_123");
  assert.throws(() => constructStripeWebhookEvent(stripe, JSON.stringify(event()), "bad", "whsec_test"));
});

test("invalid payload is rejected by signature construction", () => {
  const stripe = new Stripe("sk_test_123");
  const payload = "{";
  const secret = "whsec_test";
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });

  assert.throws(() => constructStripeWebhookEvent(stripe, payload, header, secret));
});

test("first paid event finalises order and sends email once", async () => {
  const { dependencies, state } = deps();
  const result = await processStripeEvent(event(), dependencies);

  assert.equal(result.status, "processed");
  assert.equal(state.finaliseCount, 1);
  assert.equal(state.emailCount, 1);
  assert.equal(state.completed[0].status, "processed");
});

test("duplicate processed event is skipped", async () => {
  const { dependencies, state } = deps({
    events: {
      async claimEvent() {
        return { claimStatus: "already_processed", eventId: "evt-row-1", currentStatus: "processed" };
      },
      async completeEvent() {
        state.completed.push({ status: "should_not_happen" });
      }
    }
  });
  const result = await processStripeEvent(event(), dependencies);

  assert.equal(result.status, "already_processed");
  assert.equal(state.finaliseCount, 0);
});

test("duplicate event during active processing is skipped", async () => {
  const { dependencies, state } = deps({
    events: {
      async claimEvent() {
        return { claimStatus: "already_processing", eventId: "evt-row-1", currentStatus: "processing" };
      },
      async completeEvent() {}
    }
  });
  const result = await processStripeEvent(event(), dependencies);

  assert.equal(result.status, "already_processing");
  assert.equal(state.finaliseCount, 0);
});

test("retryable failed event can be claimed and processed", async () => {
  const { dependencies, state } = deps({
    events: {
      async claimEvent() {
        return { claimStatus: "claimed", eventId: "evt-row-1", currentStatus: "processing" };
      },
      async completeEvent(input) {
        state.completed.push(input);
      }
    }
  });
  const result = await processStripeEvent(event(), dependencies);

  assert.equal(result.status, "processed");
});

test("terminal failed claim is skipped", async () => {
  const { dependencies } = deps({
    events: {
      async claimEvent() {
        return { claimStatus: "terminal", eventId: "evt-row-1", currentStatus: "failed_terminal" };
      },
      async completeEvent() {}
    }
  });
  const result = await processStripeEvent(event(), dependencies);

  assert.equal(result.status, "failed_terminal");
});

test("amount mismatch becomes terminal failure", async () => {
  const { dependencies, state } = deps();
  const result = await processStripeEvent(event("checkout.session.completed", session({ amount_total: 6000 })), dependencies);

  assert.equal(result.status, "failed_terminal");
  assert.equal(state.finaliseCount, 0);
  assert.equal(state.completed[0].status, "failed_terminal");
});

test("currency mismatch becomes terminal failure", async () => {
  const { dependencies, state } = deps();
  const result = await processStripeEvent(event("checkout.session.completed", session({ currency: "aud" })), dependencies);

  assert.equal(result.status, "failed_terminal");
  assert.equal(state.finaliseCount, 0);
});

test("unpaid checkout session does not fulfil", async () => {
  const { dependencies, state } = deps();
  const result = await processStripeEvent(event("checkout.session.completed", session({ payment_status: "unpaid" })), dependencies);

  assert.equal(result.status, "processed_deferred");
  assert.equal(state.finaliseCount, 0);
});

test("async payment succeeded finalises when paid", async () => {
  const { dependencies, state } = deps();
  const result = await processStripeEvent(event("checkout.session.async_payment_succeeded", session()), dependencies);

  assert.equal(result.status, "processed");
  assert.equal(state.finaliseCount, 1);
});

test("async payment failed marks payment failed and does not fulfil", async () => {
  const { dependencies, state } = deps();
  const result = await processStripeEvent(event("checkout.session.async_payment_failed", session({ payment_status: "unpaid" })), dependencies);

  assert.equal(result.status, "processed_deferred");
  assert.equal(state.failed, 1);
  assert.equal(state.finaliseCount, 0);
});

test("checkout expired marks checkout expired and does not email", async () => {
  const { dependencies, state } = deps();
  const result = await processStripeEvent(event("checkout.session.expired", session({ payment_status: "unpaid" })), dependencies);

  assert.equal(result.status, "processed_deferred");
  assert.equal(state.expired, 1);
  assert.equal(state.emailCount, 0);
});

test("payment_intent.payment_failed records failure without unrelated order mutation", async () => {
  const { dependencies, state } = deps();
  const result = await processStripeEvent(
    event("payment_intent.payment_failed", { id: "pi_test_1", object: "payment_intent", metadata: { order_id: "order-1" }, last_payment_error: { message: "declined" } }),
    dependencies
  );

  assert.equal(result.status, "processed_deferred");
  assert.equal(state.failed, 1);
});

test("refund and dispute events are durably processed as deferred", async () => {
  const refund = deps();
  const dispute = deps();
  const refundResult = await processStripeEvent(event("charge.refunded", { id: "ch_1", object: "charge" }), refund.dependencies);
  const disputeResult = await processStripeEvent(event("charge.dispute.created", { id: "du_1", object: "dispute" }), dispute.dependencies);

  assert.equal(refundResult.status, "processed_deferred");
  assert.equal(disputeResult.status, "processed_deferred");
  assert.equal(refund.state.finaliseCount, 0);
});

test("customer enrichment failure does not fail paid order", async () => {
  const { dependencies, state } = deps({
    customers: {
      async enrichFromFinalisedOrder() {
        throw new Error("profile failed");
      }
    }
  });
  const result = await processStripeEvent(event(), dependencies);

  assert.equal(result.status, "processed");
  assert.equal(state.finaliseCount, 1);
});

test("email failure is non-critical and event is processed", async () => {
  const { dependencies, state } = deps({
    emails: {
      async sendOrderConfirmation() {
        state.emailCount += 1;
        return "failed_retryable";
      }
    }
  });
  const result = await processStripeEvent(event(), dependencies);

  assert.equal(result.status, "processed");
  assert.equal(state.emailCount, 1);
});
