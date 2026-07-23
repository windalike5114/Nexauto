export type StripeWebhookEventCommand = {
  id: string;
  type: string;
  data: {
    object: unknown;
  };
};

export type StripeCheckoutSessionLike = {
  id: string;
  object: "checkout.session";
  metadata?: Record<string, string> | null;
  payment_status?: string | null;
  status?: string | null;
  currency?: string | null;
  amount_total?: number | null;
  amount_subtotal?: number | null;
  customer_email?: string | null;
  customer_details?: {
    email?: string | null;
    name?: string | null;
    address?: Record<string, unknown> | null;
  } | null;
  shipping_details?: {
    address?: Record<string, unknown> | null;
  } | null;
  payment_intent?: string | { id?: string | null } | null;
  invoice?: string | { id?: string | null; hosted_invoice_url?: string | null } | null;
};

export type StripePaymentIntentLike = {
  id: string;
  object: "payment_intent";
  metadata?: Record<string, string> | null;
  amount?: number | null;
  currency?: string | null;
  last_payment_error?: {
    message?: string | null;
  } | null;
};

export type StripeChargeLike = {
  id: string;
  object: "charge";
  metadata?: Record<string, string> | null;
  payment_intent?: string | null;
};
