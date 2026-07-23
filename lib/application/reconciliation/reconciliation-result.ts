export type PaymentReconciliationStatus =
  | "matched"
  | "mismatch"
  | "pending"
  | "expired"
  | "stripe_missing"
  | "internal_missing"
  | "manual_review_required";

export type PaymentReconciliationResult = {
  status: PaymentReconciliationStatus;
  orderId?: string;
  stripeSessionId?: string | null;
  expectedAmountMinor?: number;
  stripeAmountMinor?: number | null;
  expectedCurrency?: string;
  stripeCurrency?: string | null;
  internalStatus?: string;
  stripePaymentStatus?: string | null;
  stripeCheckoutStatus?: string | null;
  reason?: string;
};
