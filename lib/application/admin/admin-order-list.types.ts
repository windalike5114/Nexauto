import type { AdminAccessContext } from "@/lib/domain/admin/admin-access.types";

export const adminOrderStatuses = ["pending", "paid", "cancelled", "refunded", "failed"] as const;
export const adminFulfilmentStatuses = ["pending", "selected", "packed", "fulfilled", "issue"] as const;
export const adminEmailStatuses = ["not_recorded", "queued", "pending", "sending", "sent", "delivered", "delayed", "failed", "failed_retryable", "bounced", "complained"] as const;
export const adminOrderSorts = ["order_desc", "order_asc", "created_desc", "created_asc"] as const;

export type AdminOrderStatus = (typeof adminOrderStatuses)[number];
export type AdminFulfilmentStatus = (typeof adminFulfilmentStatuses)[number];
export type AdminEmailStatus = (typeof adminEmailStatuses)[number];
export type AdminOrderSort = (typeof adminOrderSorts)[number];

export type AdminOrderListQuery = {
  search?: string;
  orderStatus?: AdminOrderStatus;
  fulfilmentStatus?: AdminFulfilmentStatus;
  emailStatus?: AdminEmailStatus;
  needsAttention?: boolean;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
  sort: AdminOrderSort;
};

export type AdminOrderListItem = {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string | null;
  customerEmail: string | null;
  accountType: "guest" | "account";
  totalMinor: number;
  currency: string;
  orderStatus: string;
  paymentStatusLabel: string;
  fulfilmentStatus: string;
  fulfilmentStatusLabel: string;
  vehicleSummary: string;
  emailStatus: AdminEmailStatus;
  emailStatusLabel: string;
  needsAttention: boolean;
  attentionReasons: AdminAttentionReason[];
  detailUrl: string;
};

export type AdminAttentionReason =
  | "fulfilment_issue"
  | "missing_fulfilment"
  | "missing_adapter"
  | "email_failed"
  | "stale_pending";

export type AdminOrderListPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type AdminOrderListResult = {
  orders: AdminOrderListItem[];
  pagination: AdminOrderListPagination;
  activeFilters: AdminOrderListQuery;
};

export type AdminOrderListRepository = {
  listOrders(input: {
    query: AdminOrderListQuery;
    context: AdminAccessContext;
    attentionOrderIds?: string[];
    fulfilmentOrderIds?: string[];
  }): Promise<AdminOrderPageRows>;
  listAttentionOrderIds(input: { stalePendingBefore: string }): Promise<Set<string>>;
  listPageSummaries(orderIds: string[]): Promise<AdminOrderListSummaries>;
};

export type AdminOrderPageRows = {
  rows: AdminOrderRow[];
  totalItems: number;
};

export type AdminOrderRow = {
  id: string;
  orderNumber: string;
  email: string | null;
  customerName: string | null;
  customerProfileId: string | null;
  subtotal: number;
  currency: string;
  status: string;
  createdAt: string;
};

export type AdminOrderItemSummary = {
  orderId: string;
  sku: string;
  wiperSetId: string | null;
};

export type AdminVehicleSummaryRow = {
  orderId: string;
  make: string;
  model: string;
  year: number;
};

export type AdminFulfilmentSummaryRow = {
  orderId: string;
  status: string;
  driverLengthIn: number | null;
  passengerLengthIn: number | null;
  rearLengthIn: number | null;
  driverConnector: string | null;
  passengerConnector: string | null;
  rearConnector: string | null;
};

export type AdminEmailSummaryRow = {
  orderId: string;
  status: string;
  updatedAt: string;
  createdAt: string;
};

export type AdminOrderListSummaries = {
  items: AdminOrderItemSummary[];
  vehicles: AdminVehicleSummaryRow[];
  fulfilments: AdminFulfilmentSummaryRow[];
  emails: AdminEmailSummaryRow[];
};

export const adminPendingStaleAfterHours = 24;
