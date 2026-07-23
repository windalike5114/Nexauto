import test from "node:test";
import assert from "node:assert/strict";
import { getNextRetryAt } from "../lib/config/retry-policy";
import { retryOrderConfirmationEmail } from "../lib/application/email/retry-order-confirmation-email";
import { EmailRetryError } from "../lib/application/email/email-retry.errors";
import { reconcileOrderPayment } from "../lib/application/reconciliation/reconcile-order-payment";
import { assertInternalRecoveryAccess } from "../lib/application/recovery/internal-auth";
import { retryStripeWebhookEvent } from "../lib/application/webhooks/retry-stripe-webhook-event";

test("retry policy calculates deterministic email retry delay", () => {
  const now = new Date("2026-07-16T00:00:00.000Z");
  assert.equal(getNextRetryAt("email", 0, now), "2026-07-16T00:05:00.000Z");
  assert.equal(getNextRetryAt("email", 4, now), "2026-07-17T00:00:00.000Z");
});

test("retry policy calculates deterministic webhook retry delay", () => {
  const now = new Date("2026-07-16T00:00:00.000Z");
  assert.equal(getNextRetryAt("webhook", 0, now), "2026-07-16T00:05:00.000Z");
  assert.equal(getNextRetryAt("webhook", 3, now), "2026-07-16T06:00:00.000Z");
});

test("email retry rejects when no retryable email exists", async () => {
  await assert.rejects(
    retryOrderConfirmationEmail(
      { orderId: "order-1" },
      {
        repository: {
          async claimRetryableOrderConfirmation() {
            return null;
          },
          async markRetrySent() {},
          async markRetryFailed() {}
        }
      }
    ),
    (error) => error instanceof EmailRetryError && error.code === "EMAIL_RETRY_NOT_ELIGIBLE"
  );
});

test("email retry stops at application retry limit", async () => {
  let markedTerminal = false;
  await assert.rejects(
    retryOrderConfirmationEmail(
      { orderId: "order-1" },
      {
        repository: {
          async claimRetryableOrderConfirmation() {
            return {
              emailEventId: "email-1",
              dedupeKey: "order_confirmation:order-1",
              attemptCount: 5,
              order: {
                orderId: "order-1",
                orderNumber: "NEX00001",
                email: "customer@example.com",
                customerName: null,
                subtotal: 59.99,
                total: 59.99,
                currency: "nzd",
                items: [],
                vehicle: null,
                shippingAddress: {},
                billingAddress: {}
              }
            };
          },
          async markRetrySent() {},
          async markRetryFailed(input) {
            markedTerminal = input.retryable === false;
          }
        }
      }
    ),
    (error) => error instanceof EmailRetryError && error.code === "EMAIL_RETRY_LIMIT_REACHED"
  );
  assert.equal(markedTerminal, true);
});

test("payment reconciliation returns matched when Stripe and internal order agree", async () => {
  const result = await reconcileOrderPayment(
    { orderId: "order-1" },
    {
      repository: {
        async findOrder() {
          return {
            id: "order-1",
            status: "paid",
            subtotal: 59.99,
            currency: "nzd",
            stripeSessionId: "cs_live_1",
            stripePaymentIntentId: "pi_1"
          };
        },
        async retrieveStripeSession() {
          return {
            id: "cs_live_1",
            status: "complete",
            paymentStatus: "paid",
            amountTotalMinor: 5999,
            currency: "nzd",
            paymentIntentId: "pi_1"
          };
        }
      }
    }
  );
  assert.equal(result.status, "matched");
});

test("payment reconciliation flags Stripe paid/internal pending for manual review", async () => {
  const result = await reconcileOrderPayment(
    { orderId: "order-1" },
    {
      repository: {
        async findOrder() {
          return {
            id: "order-1",
            status: "pending",
            subtotal: 59.99,
            currency: "nzd",
            stripeSessionId: "cs_live_1",
            stripePaymentIntentId: null
          };
        },
        async retrieveStripeSession() {
          return {
            id: "cs_live_1",
            status: "complete",
            paymentStatus: "paid",
            amountTotalMinor: 5999,
            currency: "nzd",
            paymentIntentId: "pi_1"
          };
        }
      }
    }
  );
  assert.equal(result.status, "manual_review_required");
});

test("payment reconciliation detects amount mismatch", async () => {
  const result = await reconcileOrderPayment(
    { orderId: "order-1" },
    {
      repository: {
        async findOrder() {
          return {
            id: "order-1",
            status: "paid",
            subtotal: 59.99,
            currency: "nzd",
            stripeSessionId: "cs_live_1",
            stripePaymentIntentId: null
          };
        },
        async retrieveStripeSession() {
          return {
            id: "cs_live_1",
            status: "complete",
            paymentStatus: "paid",
            amountTotalMinor: 4999,
            currency: "nzd",
            paymentIntentId: "pi_1"
          };
        }
      }
    }
  );
  assert.equal(result.status, "mismatch");
});

test("payment reconciliation detects currency mismatch", async () => {
  const result = await reconcileOrderPayment(
    { orderId: "order-1" },
    {
      repository: {
        async findOrder() {
          return {
            id: "order-1",
            status: "paid",
            subtotal: 59.99,
            currency: "nzd",
            stripeSessionId: "cs_live_1",
            stripePaymentIntentId: null
          };
        },
        async retrieveStripeSession() {
          return {
            id: "cs_live_1",
            status: "complete",
            paymentStatus: "paid",
            amountTotalMinor: 5999,
            currency: "aud",
            paymentIntentId: "pi_1"
          };
        }
      }
    }
  );
  assert.equal(result.status, "mismatch");
});

test("internal recovery endpoint rejects missing secret", () => {
  const previous = process.env.INTERNAL_RECOVERY_SECRET;
  delete process.env.INTERNAL_RECOVERY_SECRET;
  delete process.env.CRON_SECRET;
  const response = assertInternalRecoveryAccess(new Request("https://example.com"));
  assert.equal(response?.status, 503);
  if (previous) process.env.INTERNAL_RECOVERY_SECRET = previous;
});

test("internal recovery endpoint accepts matching bearer secret", () => {
  const previous = process.env.INTERNAL_RECOVERY_SECRET;
  process.env.INTERNAL_RECOVERY_SECRET = "secret-1";
  const response = assertInternalRecoveryAccess(
    new Request("https://example.com", {
      headers: { authorization: "Bearer secret-1" }
    })
  );
  assert.equal(response, null);
  if (previous) process.env.INTERNAL_RECOVERY_SECRET = previous;
  else delete process.env.INTERNAL_RECOVERY_SECRET;
});

test("webhook retry rejects non-retryable event before Stripe retrieval", async () => {
  let retrieved = false;
  await assert.rejects(
    retryStripeWebhookEvent(
      { stripeEventId: "evt_1" },
      {
        recovery: {
          async canRetryWebhookEvent() {
            return { ok: false, reason: "processed" };
          }
        },
        stripeEvents: {
          async retrieveEvent() {
            retrieved = true;
            return null;
          }
        },
        events: {} as never,
        orders: {} as never,
        customers: {} as never,
        emails: {} as never
      }
    )
  );
  assert.equal(retrieved, false);
});
