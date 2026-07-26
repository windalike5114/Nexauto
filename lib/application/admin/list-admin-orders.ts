import type {
  AdminAttentionReason,
  AdminEmailStatus,
  AdminFulfilmentSummaryRow,
  AdminOrderItemSummary,
  AdminOrderListItem,
  AdminOrderListQuery,
  AdminOrderListRepository,
  AdminOrderListResult,
  AdminOrderRow,
  AdminVehicleSummaryRow
} from "@/lib/application/admin/admin-order-list.types";
import { adminPendingStaleAfterHours } from "@/lib/application/admin/admin-order-list.types";
import type { AdminAccessContext } from "@/lib/domain/admin/admin-access.types";
import { getOrderNumberFromSnapshot } from "@/lib/order-number";

const fulfilmentPriority = ["issue", "pending", "selected", "packed", "fulfilled"];
const failedEmailStatuses = new Set(["failed", "failed_retryable", "bounced", "complained"]);

export async function listAdminOrders(
  query: AdminOrderListQuery,
  context: AdminAccessContext,
  repository: AdminOrderListRepository
): Promise<AdminOrderListResult> {
  const stalePendingBefore = new Date(Date.now() - adminPendingStaleAfterHours * 60 * 60 * 1000).toISOString();
  const attentionOrderIds = query.needsAttention ? await repository.listAttentionOrderIds({ stalePendingBefore }) : undefined;

  const page = await repository.listOrders({
    query,
    context,
    attentionOrderIds: attentionOrderIds ? Array.from(attentionOrderIds) : undefined
  });

  const orderIds = page.rows.map((order) => order.id);
  const summaries = await repository.listPageSummaries(orderIds);

  const totalPages = Math.max(1, Math.ceil(page.totalItems / query.pageSize));
  return {
    orders: page.rows.map((order) => mapOrderListItem(order, summaries, stalePendingBefore)),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems: page.totalItems,
      totalPages,
      hasPreviousPage: query.page > 1,
      hasNextPage: query.page < totalPages
    },
    activeFilters: query
  };
}

export function mapOrderListItem(
  order: AdminOrderRow,
  summaries: {
    items: AdminOrderItemSummary[];
    vehicles: AdminVehicleSummaryRow[];
    fulfilments: AdminFulfilmentSummaryRow[];
    emails: Array<{ orderId: string; status: string; updatedAt: string; createdAt: string }>;
  },
  stalePendingBefore: string
): AdminOrderListItem {
  const items = summaries.items.filter((item) => item.orderId === order.id);
  const vehicles = summaries.vehicles.filter((vehicle) => vehicle.orderId === order.id);
  const fulfilments = summaries.fulfilments.filter((fulfilment) => fulfilment.orderId === order.id);
  const email = selectLatestEmail(summaries.emails.filter((event) => event.orderId === order.id));
  const attentionReasons = getAttentionReasons(order, items, fulfilments, email?.status, stalePendingBefore);
  const fulfilmentStatus = aggregateFulfilmentStatus(fulfilments);
  const emailStatus = mapEmailStatus(email?.status);

  return {
    id: order.id,
    orderNumber: order.orderNumber || getOrderNumberFromSnapshot(order.id, null),
    createdAt: order.createdAt,
    customerName: order.customerName,
    customerEmail: order.email,
    accountType: order.customerProfileId ? "account" : "guest",
    totalMinor: Math.round(order.subtotal * 100),
    currency: order.currency.toUpperCase(),
    orderStatus: order.status,
    paymentStatusLabel: getPaymentStatusLabel(order.status),
    fulfilmentStatus,
    fulfilmentStatusLabel: getFulfilmentStatusLabel(fulfilmentStatus),
    vehicleSummary: getVehicleSummary(vehicles),
    emailStatus,
    emailStatusLabel: getEmailStatusLabel(emailStatus),
    needsAttention: attentionReasons.length > 0,
    attentionReasons,
    detailUrl: `/admin/orders/${order.id}`
  };
}

export function aggregateFulfilmentStatus(fulfilments: AdminFulfilmentSummaryRow[]) {
  if (!fulfilments.length) return "unfulfilled";
  for (const status of fulfilmentPriority) {
    if (fulfilments.some((fulfilment) => fulfilment.status === status)) return status;
  }
  return "unknown";
}

export function selectLatestEmail<T extends { updatedAt: string; createdAt: string }>(events: T[]) {
  return [...events].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt);
    const rightTime = Date.parse(right.updatedAt || right.createdAt);
    return rightTime - leftTime;
  })[0] ?? null;
}

export function getAttentionReasons(
  order: AdminOrderRow,
  items: AdminOrderItemSummary[],
  fulfilments: AdminFulfilmentSummaryRow[],
  emailStatus: string | undefined,
  stalePendingBefore: string
): AdminAttentionReason[] {
  const reasons: AdminAttentionReason[] = [];
  const requiresWiperFulfilment = items.some((item) => Boolean(item.wiperSetId));

  if (order.status === "paid") {
    if (requiresWiperFulfilment && fulfilments.length === 0) reasons.push("missing_fulfilment");
    if (fulfilments.some((fulfilment) => fulfilment.status === "issue")) reasons.push("fulfilment_issue");
    if (fulfilments.some(hasMissingRequiredAdapter)) reasons.push("missing_adapter");
  }

  if (emailStatus && failedEmailStatuses.has(emailStatus)) reasons.push("email_failed");
  if (order.status === "pending" && Date.parse(order.createdAt) < Date.parse(stalePendingBefore)) reasons.push("stale_pending");

  return reasons;
}

export function hasMissingRequiredAdapter(fulfilment: AdminFulfilmentSummaryRow) {
  const missingDriver = fulfilment.driverLengthIn !== null && !hasText(fulfilment.driverConnector);
  const missingPassenger = fulfilment.passengerLengthIn !== null && !hasText(fulfilment.passengerConnector);
  return missingDriver || missingPassenger;
}

export function getVehicleSummary(vehicles: AdminVehicleSummaryRow[]) {
  if (!vehicles.length) return "No vehicle recorded";
  const [first, ...rest] = vehicles;
  const label = `${first.year} ${first.make} ${first.model}`.trim();
  return rest.length ? `${label} +${rest.length} more` : label;
}

export function getPaymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Payment pending",
    paid: "Paid",
    failed: "Payment failed",
    refunded: "Refunded",
    cancelled: "Cancelled"
  };
  return labels[status] ?? "Unknown";
}

export function getFulfilmentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    unfulfilled: "Unfulfilled",
    pending: "Connector selection required",
    selected: "Picking",
    packed: "Packed",
    fulfilled: "Fulfilled",
    issue: "Issue",
    unknown: "Unknown"
  };
  return labels[status] ?? "Unknown";
}

export function getEmailStatusLabel(status: AdminEmailStatus) {
  const labels: Record<AdminEmailStatus, string> = {
    not_recorded: "Not recorded",
    queued: "Queued",
    pending: "Pending",
    sending: "Sending",
    sent: "Sent",
    delivered: "Delivered",
    delayed: "Delayed",
    failed: "Failed",
    failed_retryable: "Retry required",
    bounced: "Bounced",
    complained: "Complained"
  };
  return labels[status];
}

function mapEmailStatus(status: string | undefined): AdminEmailStatus {
  if (!status) return "not_recorded";
  if (isAdminEmailStatus(status)) return status;
  return "not_recorded";
}

function isAdminEmailStatus(status: string): status is AdminEmailStatus {
  return [
    "not_recorded",
    "queued",
    "pending",
    "sending",
    "sent",
    "delivered",
    "delayed",
    "failed",
    "failed_retryable",
    "bounced",
    "complained"
  ].includes(status);
}

function hasText(value: string | null) {
  return Boolean(value?.trim());
}
