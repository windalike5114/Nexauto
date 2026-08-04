import type { AdminAccessContext } from "@/lib/domain/admin/admin-access.types";

export type AdminOrderDetailRepository = {
  loadOrderDetail(orderId: string, access: AdminAccessContext): Promise<AdminOrderDetailRepositoryResult>;
};

export type AdminOrderDetailRepositoryResult = {
  order: AdminOrderDetailOrderRow | null;
  items: AdminOrderDetailItemRow[];
  vehicleSnapshots: AdminOrderDetailVehicleSnapshotRow[];
  fulfilments: AdminOrderDetailFulfilmentRow[];
  emailEvents: AdminOrderDetailEmailEventRow[];
  webhookEvents: AdminOrderDetailWebhookEventRow[];
  auditEvents: AdminOrderDetailAuditEventRow[];
  sectionErrors: AdminOrderDetailSectionError[];
};

export type AdminOrderDetailOrderRow = {
  id: string;
  orderNumber: string | null;
  legacyOrderNumber: string;
  email: string | null;
  customerName: string | null;
  customerProfileId: string | null;
  subtotal: number;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
  itemsSnapshot: unknown;
  pricingSnapshot: unknown;
  rewardState: unknown;
};

export type AdminOrderDetailItemRow = {
  id: string;
  orderId: string;
  productId: string | null;
  variantId: string | null;
  sku: string;
  productName: string;
  attributes: Record<string, unknown>;
  qty: number;
  unitPrice: number;
  lineSubtotal: number | null;
  lineDiscount: number | null;
  lineTotal: number;
  vehicleApplicationId: string | null;
  wiperSetId: string | null;
  sourceLineKey: string | null;
  vehicleSnapshot: Record<string, unknown>;
  productSnapshot: Record<string, unknown>;
  createdAt: string | null;
};

export type AdminOrderDetailVehicleSnapshotRow = {
  id: string;
  orderId: string;
  vehicleApplicationId: string | null;
  customerVehicleId: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  startRaw: string | null;
  endRaw: string | null;
  createdAt: string | null;
};

export type AdminOrderDetailFulfilmentRow = {
  id: string;
  orderId: string;
  orderItemId: string | null;
  vehicleApplicationId: string | null;
  wiperSetId: string | null;
  driverLengthIn: number | null;
  passengerLengthIn: number | null;
  rearLengthIn: number | null;
  driverConnector: string | null;
  passengerConnector: string | null;
  rearConnector: string | null;
  connectorStatus: string;
  adminNote: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminOrderDetailEmailEventRow = {
  id: string;
  type: string;
  recipient: string;
  subject: string | null;
  status: string;
  errorCode: string | null;
  resendEmailId: string | null;
  dedupeKey: string | null;
  orderId: string | null;
  attemptCount: number | null;
  nextRetryAt: string | null;
  lastErrorSummary: string | null;
  createdAt: string;
  sentAt: string | null;
  updatedAt: string | null;
};

export type AdminOrderDetailWebhookEventRow = {
  id: string;
  stripeEventId: string;
  eventType: string;
  status: string;
  attemptCount: number;
  firstReceivedAt: string;
  lastAttemptedAt: string | null;
  processedAt: string | null;
  relatedOrderId: string | null;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  errorSummary: string | null;
  retryable: boolean;
};

export type AdminOrderDetailAuditEventRow = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AdminOrderDetail = {
  identity: AdminOrderDetailIdentity;
  customer: AdminOrderDetailCustomer;
  payment: AdminOrderDetailPayment;
  pricing: AdminOrderDetailPricing;
  items: AdminOrderDetailItem[];
  vehicleSnapshots: AdminOrderDetailVehicleSnapshot[];
  fulfilments: AdminOrderDetailFulfilment[];
  emailEvents: AdminOrderDetailEmailEvent[];
  webhookEvents: AdminOrderDetailWebhookEvent[];
  auditTimeline: AdminOrderDetailTimelineEvent[];
  warnings: AdminOrderDetailWarning[];
  sectionErrors: AdminOrderDetailSectionError[];
};

export type AdminOrderDetailIdentity = {
  id: string;
  orderNumber: string;
  orderNumberSource: "order_number" | "legacy_fallback";
  status: string;
  createdAt: string;
  updatedAt: string | null;
};

export type AdminOrderDetailCustomer = {
  name: string | null;
  email: string | null;
  phone: string | null;
  accountType: "guest" | "account";
  customerProfileId: string | null;
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
};

export type AdminOrderDetailPayment = {
  statusLabel: string;
  currency: string;
  storedTotal: number;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  stripeInvoiceUrl: string | null;
  reconciliationStatus: string | null;
};

export type AdminOrderDetailPricing = {
  source: "pricing_snapshot" | "items_snapshot" | "order_items" | "legacy_unavailable";
  currency: string;
  productSubtotal: number | null;
  bundleDiscount: number;
  welcomeRewardDiscount: number;
  couponDiscount: number;
  otherDiscount: number;
  discountTotal: number;
  shipping: number;
  gstIncluded: number | null;
  grandTotal: number;
  invariant: {
    expectedGrandTotal: number | null;
    matches: boolean | null;
  };
};

export type AdminOrderDetailItem = AdminOrderDetailItemRow & {
  productType: "front_wiper_pair" | "rear_wiper" | "front_and_rear_wiper" | "non_wiper" | "unknown_wiper";
  relatedVehicleSnapshotIds: string[];
  relatedFulfilmentIds: string[];
};

export type AdminOrderDetailVehicleSnapshot = AdminOrderDetailVehicleSnapshotRow & {
  label: string;
};

export type AdminOrderDetailFulfilment = AdminOrderDetailFulfilmentRow & {
  relationship: {
    kind: "order_item" | "wiper_set" | "vehicle_application" | "legacy_order_level" | "unavailable";
    label: string;
    itemId: string | null;
  };
};

export type AdminOrderDetailEmailEvent = AdminOrderDetailEmailEventRow & {
  isStableOrderConfirmation: boolean;
  displayTimestamp: string;
};

export type AdminOrderDetailWebhookEvent = AdminOrderDetailWebhookEventRow & {
  displayTimestamp: string;
  classification: "processed" | "retryable" | "terminal" | "processing" | "received";
};

export type AdminOrderDetailWarning = {
  code:
    | "missing_fulfilment_record"
    | "missing_vehicle_snapshot"
    | "missing_wiper_set"
    | "missing_driver_length"
    | "missing_passenger_length"
    | "missing_rear_length"
    | "missing_driver_connector"
    | "missing_passenger_connector"
    | "missing_rear_connector"
    | "fulfilment_issue"
    | "pricing_snapshot_legacy"
    | "pricing_invariant_mismatch"
    | "email_failure"
    | "webhook_failure"
    | "reconciliation_warning";
  severity: "critical" | "warning" | "information";
  title: string;
  message: string;
  relatedItemId?: string;
  relatedFulfilmentId?: string;
  blocksFulfilment: boolean;
};

export type AdminOrderDetailSectionError = {
  section: "email" | "webhook" | "audit" | "customer";
  title: string;
  message: string;
};

export type AdminOrderDetailTimelineEvent = {
  id: string;
  timestamp: string;
  category: "order" | "payment" | "email" | "webhook" | "audit";
  status: string;
  title: string;
  description: string;
  source: string;
  relatedIdentifier: string | null;
};
