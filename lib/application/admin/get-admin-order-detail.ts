import type { AdminAccessContext } from "@/lib/domain/admin/admin-access.types";
import { isLooseUuid } from "@/lib/domain/shared/uuid";
import type {
  AdminOrderDetail,
  AdminOrderDetailEmailEventRow,
  AdminOrderDetailEmailEvent,
  AdminOrderDetailFulfilment,
  AdminOrderDetailItem,
  AdminOrderDetailOrderRow,
  AdminOrderDetailPricing,
  AdminOrderDetailRepository,
  AdminOrderDetailTimelineEvent,
  AdminOrderDetailVehicleSnapshot,
  AdminOrderDetailWarning,
  AdminOrderDetailWebhookEventRow,
  AdminOrderDetailWebhookEvent
} from "./admin-order-detail.types";

export class AdminOrderDetailInvalidIdError extends Error {
  constructor() {
    super("Admin order detail requires a valid order ID.");
    this.name = "AdminOrderDetailInvalidIdError";
  }
}

export class AdminOrderDetailNotFoundError extends Error {
  constructor() {
    super("Order was not found.");
    this.name = "AdminOrderDetailNotFoundError";
  }
}

export class AdminOrderDetailCriticalError extends Error {
  constructor(message = "Order detail could not be loaded.") {
    super(message);
    this.name = "AdminOrderDetailCriticalError";
  }
}

export async function getAdminOrderDetail(orderId: string, access: AdminAccessContext, repository: AdminOrderDetailRepository): Promise<AdminOrderDetail> {
  if (!isLooseUuid(orderId)) throw new AdminOrderDetailInvalidIdError();

  const data = await repository.loadOrderDetail(orderId, access);
  if (!data.order) throw new AdminOrderDetailNotFoundError();

  const order = data.order;
  const vehicleSnapshots = data.vehicleSnapshots.map((vehicle): AdminOrderDetailVehicleSnapshot => ({
    ...vehicle,
    label: formatVehicleLabel(vehicle.year, vehicle.make, vehicle.model)
  }));
  const items = data.items.map((item): AdminOrderDetailItem => {
    const productType = classifyItem(item);
    return {
      ...item,
      productType,
      relatedVehicleSnapshotIds: findRelatedVehicleSnapshotIds(item.vehicleApplicationId, vehicleSnapshots),
      relatedFulfilmentIds: []
    };
  });
  const fulfilments = data.fulfilments.map((fulfilment): AdminOrderDetailFulfilment => ({
    ...fulfilment,
    relationship: relateFulfilment(fulfilment, items)
  }));
  for (const item of items) {
    item.relatedFulfilmentIds = fulfilments
      .filter((fulfilment) => fulfilment.relationship.itemId === item.id)
      .map((fulfilment) => fulfilment.id);
  }

  const pricing = mapPricing(order, items);
  const emailEvents = mapEmailEvents(data.emailEvents, order.id);
  const webhookEvents = mapWebhookEvents(data.webhookEvents);
  const warnings = buildWarnings({ orderStatus: order.status, pricing, items, vehicleSnapshots, fulfilments, emailEvents, webhookEvents });

  return {
    identity: {
      id: order.id,
      orderNumber: order.orderNumber?.trim() || order.legacyOrderNumber,
      orderNumberSource: order.orderNumber?.trim() ? "order_number" : "legacy_fallback",
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    },
    customer: {
      name: order.customerName,
      email: order.email,
      phone: getFirstString(order.shippingAddress.phone, order.billingAddress.phone),
      accountType: order.customerProfileId ? "account" : "guest",
      customerProfileId: order.customerProfileId,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress
    },
    payment: {
      statusLabel: getPaymentStatusLabel(order.status),
      currency: order.currency,
      storedTotal: order.subtotal,
      stripeSessionId: order.stripeSessionId,
      stripePaymentIntentId: order.stripePaymentIntentId,
      stripeInvoiceId: getStripeSnapshotString(order.itemsSnapshot, "invoice_id"),
      stripeInvoiceUrl: getStripeSnapshotString(order.itemsSnapshot, "invoice_url"),
      reconciliationStatus: getStringPath(order.itemsSnapshot, ["reconciliation", "status"])
    },
    pricing,
    items,
    vehicleSnapshots,
    fulfilments,
    emailEvents,
    webhookEvents,
    auditTimeline: buildTimeline({ order, emailEvents, webhookEvents, auditEvents: data.auditEvents }),
    warnings,
    sectionErrors: data.sectionErrors
  };
}

export function mapPricing(order: Pick<AdminOrderDetailOrderRow, "currency" | "subtotal" | "pricingSnapshot" | "itemsSnapshot">, items: AdminOrderDetailItem[]): AdminOrderDetailPricing {
  const canonical = parseCanonicalPricing(order.pricingSnapshot);
  if (canonical) return withInvariant(canonical);

  const legacySnapshot = parseLegacyPricing(order.pricingSnapshot) ?? parseLegacyPricing(getObjectPath(order.itemsSnapshot, ["pricing"]));
  if (legacySnapshot) return withInvariant({ ...legacySnapshot, source: "items_snapshot", currency: order.currency, grandTotal: legacySnapshot.grandTotal ?? order.subtotal });

  const itemPricing = buildPricingFromOrderItems({ order, items });
  if (itemPricing) return withInvariant(itemPricing);

  return {
    source: "legacy_unavailable",
    currency: order.currency,
    productSubtotal: null,
    bundleDiscount: 0,
    welcomeRewardDiscount: 0,
    couponDiscount: 0,
    otherDiscount: 0,
    discountTotal: 0,
    shipping: 0,
    gstIncluded: null,
    grandTotal: order.subtotal,
    invariant: { expectedGrandTotal: null, matches: null }
  };
}

export function buildWarnings(input: {
  orderStatus: string;
  pricing: AdminOrderDetailPricing;
  items: AdminOrderDetailItem[];
  vehicleSnapshots: AdminOrderDetailVehicleSnapshot[];
  fulfilments: AdminOrderDetailFulfilment[];
  emailEvents: AdminOrderDetailEmailEvent[];
  webhookEvents: AdminOrderDetailWebhookEvent[];
}): AdminOrderDetailWarning[] {
  const warnings: AdminOrderDetailWarning[] = [];
  const wiperItems = input.items.filter((item) => item.productType !== "non_wiper");

  if (input.pricing.source === "items_snapshot" || input.pricing.source === "order_items" || input.pricing.source === "legacy_unavailable") {
    warnings.push(warning("pricing_snapshot_legacy", "information", "Legacy pricing basis", "This order is using a legacy pricing snapshot fallback for display.", false));
  }
  if (input.pricing.invariant.matches === false) {
    warnings.push(warning("pricing_invariant_mismatch", "warning", "Pricing mismatch", "Stored pricing values do not reconcile. Preserve the historical amounts and review before fulfilment.", false));
  }
  if (wiperItems.length && input.vehicleSnapshots.length === 0) {
    warnings.push(warning("missing_vehicle_snapshot", "warning", "Vehicle snapshot missing", "This wiper order does not have a stored vehicle snapshot.", false));
  }

  for (const item of wiperItems) {
    const relatedFulfilments = input.fulfilments.filter((fulfilment) => fulfilment.relationship.itemId === item.id);
    if (input.orderStatus === "paid" && relatedFulfilments.length === 0) {
      warnings.push(warning("missing_fulfilment_record", "critical", "Fulfilment record missing", "This paid wiper item does not have a fulfilment row.", true, item.id));
      continue;
    }
    if (item.productType === "front_wiper_pair" && !item.wiperSetId) {
      warnings.push(warning("missing_wiper_set", "warning", "Wiper set ID missing", "This front pair is missing a stored wiper set ID. Use the SKU and historical snapshot to confirm manually.", false, item.id));
    }
  }

  for (const fulfilment of input.fulfilments) {
    const item = input.items.find((candidate) => candidate.id === fulfilment.relationship.itemId);
    const productType = item?.productType ?? classifyFulfilment(fulfilment);
    if (productType === "non_wiper") continue;

    if (fulfilment.connectorStatus === "issue") {
      warnings.push(warning("fulfilment_issue", "critical", "Fulfilment issue", "This fulfilment row is marked as issue.", true, item?.id, fulfilment.id));
    }
    if ((productType === "front_wiper_pair" || productType === "front_and_rear_wiper" || productType === "unknown_wiper") && fulfilment.driverLengthIn === null) {
      warnings.push(warning("missing_driver_length", "critical", "Driver length missing", "Driver-side blade length is required for a front wiper pair.", true, item?.id, fulfilment.id));
    }
    if ((productType === "front_wiper_pair" || productType === "front_and_rear_wiper" || productType === "unknown_wiper") && fulfilment.passengerLengthIn === null) {
      warnings.push(warning("missing_passenger_length", "critical", "Passenger length missing", "Passenger-side blade length is required for a front wiper pair.", true, item?.id, fulfilment.id));
    }
    if ((productType === "rear_wiper" || productType === "front_and_rear_wiper") && fulfilment.rearLengthIn === null) {
      warnings.push(warning("missing_rear_length", "critical", "Rear length missing", "Rear blade length is required for this wiper fulfilment row.", true, item?.id, fulfilment.id));
    }
    if (requiresAdapter(productType, "front") && fulfilment.driverLengthIn !== null && isBlank(fulfilment.driverConnector)) {
      warnings.push(warning("missing_driver_connector", "critical", "Driver adapter missing", "Driver-side adapter/connector has not been selected.", true, item?.id, fulfilment.id));
    }
    if (requiresAdapter(productType, "front") && fulfilment.passengerLengthIn !== null && isBlank(fulfilment.passengerConnector)) {
      warnings.push(warning("missing_passenger_connector", "critical", "Passenger adapter missing", "Passenger-side adapter/connector has not been selected.", true, item?.id, fulfilment.id));
    }
    if (requiresAdapter(productType, "rear") && fulfilment.rearLengthIn !== null && isBlank(fulfilment.rearConnector)) {
      warnings.push(warning("missing_rear_connector", "warning", "Rear adapter missing", "Rear adapter/connector has not been selected.", false, item?.id, fulfilment.id));
    }
  }

  if (input.emailEvents.some((event) => ["failed", "failed_retryable", "bounced", "complained"].includes(event.status))) {
    warnings.push(warning("email_failure", "warning", "Email delivery issue", "A related order email has a failed or complaint status.", false));
  }
  if (input.webhookEvents.some((event) => ["failed_retryable", "failed_terminal"].includes(event.status))) {
    warnings.push(warning("webhook_failure", "warning", "Webhook issue", "A related Stripe webhook event did not process cleanly.", false));
  }

  return warnings;
}

function parseCanonicalPricing(value: unknown): Omit<AdminOrderDetailPricing, "invariant"> | null {
  if (!isRecord(value)) return null;
  const grandTotalMinor = toNumber(value.grandTotalMinor);
  const productSubtotalMinor = toNumber(value.productSubtotalMinor);
  if (grandTotalMinor === null || productSubtotalMinor === null) return null;
  return {
    source: "pricing_snapshot",
    currency: getString(value.currency) ?? "nzd",
    productSubtotal: fromMinor(productSubtotalMinor),
    bundleDiscount: fromMinor(toNumber(value.bundleDiscountMinor) ?? 0),
    welcomeRewardDiscount: fromMinor(toNumber(value.welcomeRewardMinor) ?? 0),
    couponDiscount: fromMinor(toNumber(value.couponDiscountMinor) ?? 0),
    otherDiscount: fromMinor(Math.max(0, (toNumber(value.discountTotalMinor) ?? 0) - (toNumber(value.bundleDiscountMinor) ?? 0) - (toNumber(value.welcomeRewardMinor) ?? 0) - (toNumber(value.couponDiscountMinor) ?? 0))),
    discountTotal: fromMinor(toNumber(value.discountTotalMinor) ?? 0),
    shipping: fromMinor(toNumber(value.shippingMinor) ?? 0),
    gstIncluded: fromMinor(toNumber(value.gstIncludedMinor) ?? toNumber(value.taxIncludedMinor) ?? 0),
    grandTotal: fromMinor(grandTotalMinor)
  };
}

function parseLegacyPricing(value: unknown): (Omit<AdminOrderDetailPricing, "invariant" | "source" | "currency"> & { grandTotal: number | null }) | null {
  if (!isRecord(value)) return null;
  const finalSubtotal = toNumber(value.finalSubtotal ?? value.total);
  if (finalSubtotal === null) return null;
  const bundleDiscount = toNumber(value.bundleDiscount) ?? 0;
  const welcomeRewardDiscount = toNumber(value.welcomeRewardDiscount ?? value.rewardDiscount) ?? 0;
  const couponDiscount = toNumber(value.couponDiscount) ?? 0;
  const discountTotal = bundleDiscount + welcomeRewardDiscount + couponDiscount;
  return {
    productSubtotal: toNumber(value.productsSubtotal ?? value.merchandiseSubtotal),
    bundleDiscount,
    welcomeRewardDiscount,
    couponDiscount,
    otherDiscount: 0,
    discountTotal,
    shipping: toNumber(value.shipping ?? value.shippingAmount) ?? 0,
    gstIncluded: toNumber(value.gstIncluded ?? value.taxAmount),
    grandTotal: finalSubtotal
  };
}

function buildPricingFromOrderItems({
  order,
  items
}: {
  order: { currency: string; subtotal: number };
  items: AdminOrderDetailItem[];
}): Omit<AdminOrderDetailPricing, "invariant"> | null {
  if (!items.length) return null;
  const productSubtotal = items.reduce((sum, item) => sum + (item.lineSubtotal ?? item.unitPrice * item.qty), 0);
  const discountTotal = items.reduce((sum, item) => sum + (item.lineDiscount ?? 0), 0);
  const grandTotal = items.reduce((sum, item) => sum + item.lineTotal, 0) || order.subtotal;
  return {
    source: "order_items",
    currency: order.currency,
    productSubtotal,
    bundleDiscount: discountTotal,
    welcomeRewardDiscount: 0,
    couponDiscount: 0,
    otherDiscount: 0,
    discountTotal,
    shipping: Math.max(0, order.subtotal - grandTotal),
    gstIncluded: null,
    grandTotal: order.subtotal
  };
}

function withInvariant(pricing: Omit<AdminOrderDetailPricing, "invariant">): AdminOrderDetailPricing {
  const expectedGrandTotal = pricing.productSubtotal === null ? null : roundMoney(Math.max(0, pricing.productSubtotal - pricing.discountTotal) + pricing.shipping);
  return {
    ...pricing,
    grandTotal: roundMoney(pricing.grandTotal),
    invariant: {
      expectedGrandTotal,
      matches: expectedGrandTotal === null ? null : Math.abs(expectedGrandTotal - roundMoney(pricing.grandTotal)) < 0.01
    }
  };
}

function classifyItem(item: {
  sku: string;
  productId: string | null;
  wiperSetId: string | null;
  attributes: Record<string, unknown>;
  productSnapshot: Record<string, unknown>;
}): AdminOrderDetailItem["productType"] {
  const productId = getFirstString(item.productId, item.attributes.logical_product_id, item.productSnapshot.product_id);
  const category = getFirstString(item.productSnapshot.category, item.attributes.category);
  const sku = item.sku.toUpperCase();
  if (productId === "wiper_set" || item.wiperSetId || sku.startsWith("WPFP")) return "front_wiper_pair";
  if (productId === "wiper_rear_addon" || sku.includes("REAR")) return "rear_wiper";
  if (category?.includes("wiper")) return "unknown_wiper";
  return "non_wiper";
}

function classifyFulfilment(fulfilment: AdminOrderDetailFulfilment): AdminOrderDetailItem["productType"] {
  if (fulfilment.driverLengthIn !== null || fulfilment.passengerLengthIn !== null) {
    return fulfilment.rearLengthIn !== null ? "front_and_rear_wiper" : "front_wiper_pair";
  }
  if (fulfilment.rearLengthIn !== null) return "rear_wiper";
  return "unknown_wiper";
}

function relateFulfilment(
  fulfilment: { orderItemId: string | null; wiperSetId: string | null; vehicleApplicationId: string | null },
  items: AdminOrderDetailItem[]
): AdminOrderDetailFulfilment["relationship"] {
  if (fulfilment.orderItemId) {
    const item = items.find((candidate) => candidate.id === fulfilment.orderItemId);
    return { kind: "order_item", label: item ? `Item ${item.sku}` : "Related item unavailable", itemId: item?.id ?? fulfilment.orderItemId };
  }
  if (fulfilment.wiperSetId) {
    const item = items.find((candidate) => candidate.wiperSetId === fulfilment.wiperSetId);
    return { kind: "wiper_set", label: item ? `Wiper set ${item.sku}` : "Wiper set relationship", itemId: item?.id ?? null };
  }
  if (fulfilment.vehicleApplicationId) {
    const item = items.find((candidate) => candidate.vehicleApplicationId === fulfilment.vehicleApplicationId);
    return { kind: "vehicle_application", label: item ? `Vehicle item ${item.sku}` : "Vehicle application relationship", itemId: item?.id ?? null };
  }
  if (items.length === 1) return { kind: "legacy_order_level", label: "Legacy order-level fulfilment", itemId: items[0]?.id ?? null };
  return { kind: "unavailable", label: "Relationship unavailable", itemId: null };
}

function mapEmailEvents(events: AdminOrderDetailEmailEventRow[], orderId: string): AdminOrderDetailEmailEvent[] {
  const confirmationKey = `order_confirmation:${orderId}`;
  return sortByDisplayTimestamp(
    events.map((event) => ({
      ...event,
      isStableOrderConfirmation: event.dedupeKey === confirmationKey,
      displayTimestamp: event.updatedAt ?? event.sentAt ?? event.createdAt
    }))
  );
}

function mapWebhookEvents(events: AdminOrderDetailWebhookEventRow[]): AdminOrderDetailWebhookEvent[] {
  return sortByDisplayTimestamp(
    events.map((event) => ({
      ...event,
      displayTimestamp: event.processedAt ?? event.lastAttemptedAt ?? event.firstReceivedAt,
      classification: classifyWebhookStatus(event.status)
    }))
  );
}

function buildTimeline(input: {
  order: { id: string; createdAt: string; status: string; stripeSessionId: string | null; stripePaymentIntentId: string | null };
  emailEvents: AdminOrderDetailEmailEvent[];
  webhookEvents: AdminOrderDetailWebhookEvent[];
  auditEvents: Array<{ id: string; eventType: string; entityType: string; entityId: string; summary: string; createdAt: string }>;
}): AdminOrderDetailTimelineEvent[] {
  const events: AdminOrderDetailTimelineEvent[] = [
    {
      id: `order:${input.order.id}`,
      timestamp: input.order.createdAt,
      category: "order",
      status: input.order.status,
      title: "Order created",
      description: "Persisted order record.",
      source: "orders",
      relatedIdentifier: input.order.id
    },
    ...input.emailEvents.map((event) => ({
      id: `email:${event.id}`,
      timestamp: event.displayTimestamp,
      category: "email" as const,
      status: event.status,
      title: event.type,
      description: event.lastErrorSummary ?? event.subject ?? "Email lifecycle event.",
      source: "email_events",
      relatedIdentifier: event.resendEmailId
    })),
    ...input.webhookEvents.map((event) => ({
      id: `webhook:${event.id}`,
      timestamp: event.displayTimestamp,
      category: "webhook" as const,
      status: event.status,
      title: event.eventType,
      description: event.errorSummary ?? `Stripe event ${event.stripeEventId}`,
      source: "stripe_webhook_events",
      relatedIdentifier: event.stripeEventId
    })),
    ...input.auditEvents.map((event) => ({
      id: `audit:${event.id}`,
      timestamp: event.createdAt,
      category: "audit" as const,
      status: event.eventType,
      title: event.eventType,
      description: event.summary,
      source: "system_audit_events",
      relatedIdentifier: event.entityId
    }))
  ];
  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function warning(
  code: AdminOrderDetailWarning["code"],
  severity: AdminOrderDetailWarning["severity"],
  title: string,
  message: string,
  blocksFulfilment: boolean,
  relatedItemId?: string,
  relatedFulfilmentId?: string
): AdminOrderDetailWarning {
  return { code, severity, title, message, blocksFulfilment, relatedItemId, relatedFulfilmentId };
}

function requiresAdapter(productType: AdminOrderDetailItem["productType"], area: "front" | "rear") {
  if (productType === "non_wiper") return false;
  if (area === "front") return productType === "front_wiper_pair" || productType === "front_and_rear_wiper" || productType === "unknown_wiper";
  return productType === "rear_wiper" || productType === "front_and_rear_wiper";
}

function findRelatedVehicleSnapshotIds(vehicleApplicationId: string | null, vehicles: AdminOrderDetailVehicleSnapshot[]) {
  if (!vehicleApplicationId) return [];
  return vehicles.filter((vehicle) => vehicle.vehicleApplicationId === vehicleApplicationId).map((vehicle) => vehicle.id);
}

function getPaymentStatusLabel(status: string) {
  if (status === "paid") return "Paid";
  if (status === "failed") return "Failed";
  if (status === "refunded") return "Refunded";
  if (status === "pending") return "Pending";
  return status;
}

function classifyWebhookStatus(status: string): AdminOrderDetailWebhookEvent["classification"] {
  if (status === "processed" || status === "processed_deferred") return "processed";
  if (status === "failed_retryable") return "retryable";
  if (status === "failed_terminal") return "terminal";
  if (status === "processing") return "processing";
  return "received";
}

function sortByDisplayTimestamp<T extends { displayTimestamp: string }>(events: T[]): T[] {
  return [...events].sort((a, b) => b.displayTimestamp.localeCompare(a.displayTimestamp));
}

function formatVehicleLabel(year: number | null, make: string | null, model: string | null) {
  return [year, make, model].filter(Boolean).join(" ") || "Vehicle details unavailable";
}

function getStripeSnapshotString(snapshot: unknown, key: string) {
  return getStringPath(snapshot, ["stripe", key]);
}

function getStringPath(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return getString(current);
}

function getObjectPath(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return isRecord(current) ? current : null;
}

function getFirstString(...values: unknown[]) {
  for (const value of values) {
    const stringValue = getString(value);
    if (stringValue) return stringValue;
  }
  return null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isBlank(value: string | null) {
  return !value || !value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fromMinor(value: number) {
  return roundMoney(value / 100);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
