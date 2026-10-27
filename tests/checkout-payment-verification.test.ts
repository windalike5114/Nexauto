import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyCheckoutPayment } from "../lib/application/checkout/verify-checkout-payment";

const id = "cs_test_verifiedPayment123";
const paid = { id, status: "complete", payment_status: "paid" };

test("missing, repeated and malformed session parameters cannot confirm or contact Stripe", async () => {
  for (const value of [undefined, null, "", "anything", [id, id], "cs_test_<script>", "cs_test_" + "a".repeat(241)]) {
    let calls = 0;
    assert.equal(await verifyCheckoutPayment(value, async () => { calls++; return paid; }), null);
    assert.equal(calls, 0);
  }
});

test("only completed and paid provider sessions confirm payment", async () => {
  for (const status of ["open", "expired", "complete", null]) {
    for (const payment_status of ["unpaid", "no_payment_required", "paid"]) {
      const session = { id, status, payment_status };
      const result = await verifyCheckoutPayment(id, async requested => {
        assert.equal(requested, id);
        return session;
      });
      assert.equal(result, status === "complete" && payment_status === "paid" ? session : null);
    }
  }
});

test("provider outage or unknown session falls back to pending", async () => {
  assert.equal(await verifyCheckoutPayment(id, async () => { throw new Error("Stripe unavailable"); }), null);
});

test("a different returned session cannot confirm the requested payment", async () => {
  assert.equal(await verifyCheckoutPayment(id, async () => ({ ...paid, id: "cs_test_other" })), null);
});

test("live and test sessions use the same payment verification", async () => {
  const live = { ...paid, id: "cs_live_verifiedPayment123" };
  assert.equal(await verifyCheckoutPayment(live.id, async () => live), live);
  assert.equal(await verifyCheckoutPayment(id, async () => paid), paid);
});

test("page gates order access and success actions on verified payment and disables shared caching", () => {
  const page = readFileSync("app/checkout/success/page.tsx", "utf8");
  assert.match(page, /verifyCheckoutPayment\(sessionId/);
  assert.match(page, /const paymentConfirmed = checkoutSession !== null/);
  assert.match(page, /paymentConfirmed \? await loadOrderByStripeSession/);
  assert.match(page, /\{paymentConfirmed \? <CheckoutSuccessActions/);
  assert.match(page, /Awaiting payment confirmation/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
});

test("client refuses to clear the cart or show success without server confirmation", () => {
  const client = readFileSync("components/checkout-success-actions.tsx", "utf8");
  assert.match(client, /if \(!paymentConfirmed \|\| clearedRef.current\) return/);
  assert.match(client, /if \(!paymentConfirmed\) return null/);
  assert.ok(client.indexOf("if (!paymentConfirmed || clearedRef.current) return") < client.indexOf('window.localStorage.setItem("nexauto-cart"'));
});
