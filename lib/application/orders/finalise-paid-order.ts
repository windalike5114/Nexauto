import type { StripeCheckoutSessionLike } from "@/lib/application/webhooks/stripe-event-command";

export type PendingOrderSnapshotItem = {
  product_id: string;
  variant_id: string;
  sku: string;
  product_name: string;
  attributes: Record<string, string | number>;
  qty: number;
  unit_price: number;
  line_subtotal?: number;
  line_discount?: number;
  line_total: number;
  bundle_discount?: number;
  source_line_key?: string;
  vehicle_application_id?: string | null;
  wiper_set_id?: string | null;
  vehicle_snapshot?: Record<string, unknown>;
  product_snapshot?: Record<string, unknown>;
};

export type PendingOrderSnapshot = {
  checkout_version?: string;
  pricing_version?: string;
  checkout_request_id?: string;
  order_number?: string;
  items?: PendingOrderSnapshotItem[];
  vehicle?: {
    a?: string | number | null;
    make?: string | number | null;
    model?: string | number | null;
    year?: string | number | null;
  } | null;
  pricing?: {
    finalSubtotal?: number;
    couponCode?: string | null;
    [key: string]: unknown;
  };
  reward_state?: Record<string, unknown> | null;
  stripe?: Record<string, unknown>;
  [key: string]: unknown;
};

export type FinalisableOrder = {
  id: string;
  email: string | null;
  customerName: string | null;
  subtotal: number;
  currency: string;
  status: string;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  itemsSnapshot: PendingOrderSnapshot;
};

export type OrderFinalisationInput = {
  order: FinalisableOrder;
  session: StripeCheckoutSessionLike;
  invoice: {
    id?: string | null;
    hostedInvoiceUrl?: string | null;
  } | null;
  sourceLineKeys: string[];
};

export type FinalisedOrder = {
  orderId: string;
  orderNumber: string;
  email: string | null;
  customerName: string | null;
  subtotal: number;
  total: number;
  currency: string;
  items: PendingOrderSnapshotItem[];
  vehicle: PendingOrderSnapshot["vehicle"];
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
};
