import type { PaymentReconciliationResult } from "./reconciliation-result";

export type ReconciliationOrder = {
  id: string;
  status: string;
  subtotal: number;
  currency: string;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
};

export type ReconciliationStripeSession = {
  id: string;
  status: string | null;
  paymentStatus: string | null;
  amountTotalMinor: number | null;
  currency: string | null;
  paymentIntentId: string | null;
};

export type PaymentReconciliationRepository = {
  findOrder(input: { orderId?: string; stripeSessionId?: string }): Promise<ReconciliationOrder | null>;
  retrieveStripeSession(stripeSessionId: string): Promise<ReconciliationStripeSession | null>;
};

export async function reconcileOrderPayment(
  input: { orderId?: string; stripeSessionId?: string },
  dependencies: { repository: PaymentReconciliationRepository }
): Promise<PaymentReconciliationResult> {
  const order = await dependencies.repository.findOrder(input);
  if (!order) return { status: "internal_missing", reason: "Internal order was not found." };
  if (!order.stripeSessionId) {
    return { status: "manual_review_required", orderId: order.id, internalStatus: order.status, reason: "Order has no Stripe session ID." };
  }

  const session = await dependencies.repository.retrieveStripeSession(order.stripeSessionId);
  if (!session) return { status: "stripe_missing", orderId: order.id, stripeSessionId: order.stripeSessionId };

  const expectedAmountMinor = Math.round(order.subtotal * 100);
  const expectedCurrency = order.currency.toLowerCase();
  const stripeCurrency = session.currency?.toLowerCase() ?? null;

  const common = {
    orderId: order.id,
    stripeSessionId: session.id,
    expectedAmountMinor,
    stripeAmountMinor: session.amountTotalMinor,
    expectedCurrency,
    stripeCurrency,
    internalStatus: order.status,
    stripePaymentStatus: session.paymentStatus,
    stripeCheckoutStatus: session.status
  };

  if (session.status === "expired") return { ...common, status: "expired" };
  if (session.paymentStatus !== "paid") return { ...common, status: order.status === "paid" ? "mismatch" : "pending" };
  if (session.amountTotalMinor !== expectedAmountMinor || stripeCurrency !== expectedCurrency) {
    return { ...common, status: "mismatch", reason: "Stripe amount or currency does not match the internal order." };
  }
  if (order.status !== "paid") return { ...common, status: "manual_review_required", reason: "Stripe is paid but internal order is not finalised." };
  return { ...common, status: "matched" };
}
