import { createSupabaseAdminClient } from "@/lib/supabase";
import type {
  AdminFulfilmentSummaryRow,
  AdminOrderItemSummary,
  AdminOrderListQuery,
  AdminOrderListRepository,
  AdminOrderPageRows,
  AdminOrderRow,
  AdminVehicleSummaryRow
} from "@/lib/application/admin/admin-order-list.types";
import { hasMissingRequiredAdapter } from "@/lib/application/admin/list-admin-orders";
import { getOrderNumberFromSnapshot } from "@/lib/order-number";

type SupabaseOrderFilter = any;

type OrderRow = {
  id: string;
  order_number?: string | null;
  items_snapshot?: unknown;
  email: string | null;
  customer_name: string | null;
  customer_profile_id: string | null;
  subtotal: string | number;
  currency: string;
  status: string;
  created_at: string;
};

type OrderItemRow = {
  order_id: string;
  sku: string;
  wiper_set_id: string | null;
};

type VehicleRow = {
  order_id: string;
  make_snapshot: string;
  model_snapshot: string;
  year: number;
};

type FulfilmentRow = {
  order_id: string;
  connector_status: string;
  driver_length_in: string | number | null;
  passenger_length_in: string | number | null;
  rear_length_in: string | number | null;
  driver_connector: string | null;
  passenger_connector: string | null;
  rear_connector: string | null;
};

type EmailRow = {
  order_id: string | null;
  dedupe_key: string | null;
  status: string;
  updated_at: string;
  created_at: string;
};

const orderSelect = "id,order_number,email,customer_name,customer_profile_id,subtotal,currency,status,created_at";
const legacyOrderSelect = "id,items_snapshot,email,customer_name,customer_profile_id,subtotal,currency,status,created_at";
const failedEmailStatuses = ["failed", "failed_retryable", "bounced", "complained"];

export function createAdminOrderRepository(): AdminOrderListRepository {
  return {
    listOrders,
    listAttentionOrderIds,
    listPageSummaries
  };
}

export function buildOrderSearchOrFilter(search: string) {
  return buildOrderSearchOrFilterWithOptions(search, { includeOrderNumber: true });
}

export function buildOrderSearchOrFilterWithOptions(search: string, { includeOrderNumber }: { includeOrderNumber: boolean }) {
  const pattern = `*${search.replace(/\*/g, " ")}*`;
  const fields = includeOrderNumber ? ["order_number", "email", "customer_name"] : ["email", "customer_name"];
  return fields.map((field) => `${field}.ilike.${pattern}`).join(",");
}

async function listOrders({
  query,
  attentionOrderIds
}: Parameters<AdminOrderListRepository["listOrders"]>[0]): Promise<AdminOrderPageRows> {
  if (query.needsAttention && attentionOrderIds?.length === 0) {
    return { rows: [], totalItems: 0 };
  }

  const supabase = getAdminOrThrow();
  const fulfilmentOrderIds = query.fulfilmentStatus ? await listOrderIdsByFulfilmentStatus(query.fulfilmentStatus) : undefined;
  if (query.fulfilmentStatus && fulfilmentOrderIds?.length === 0) {
    return { rows: [], totalItems: 0 };
  }

  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  let request = buildOrdersRequest(supabase, {
    select: orderSelect,
    query,
    attentionOrderIds,
    fulfilmentOrderIds,
    includeOrderNumber: true
  });

  let { data, error, count } = await request.range(from, to);

  if (isMissingOrderNumberColumnError(error)) {
    const legacyQuery = { ...query, sort: query.sort === "order_asc" ? "created_asc" : query.sort === "order_desc" ? "created_desc" : query.sort };
    request = buildOrdersRequest(supabase, {
      select: legacyOrderSelect,
      query: legacyQuery,
      attentionOrderIds,
      fulfilmentOrderIds,
      includeOrderNumber: false
    });
    const legacyResult = await request.range(from, to);
    data = legacyResult.data;
    error = legacyResult.error;
    count = legacyResult.count;
  }

  if (error) throw error;

  return {
    rows: ((data ?? []) as OrderRow[]).map(mapOrderRow),
    totalItems: count ?? 0
  };
}

function buildOrdersRequest(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  {
    select,
    query,
    attentionOrderIds,
    fulfilmentOrderIds,
    includeOrderNumber
  }: {
    select: string;
    query: AdminOrderListQuery;
    attentionOrderIds?: string[];
    fulfilmentOrderIds?: string[];
    includeOrderNumber: boolean;
  }
) {
  let request: SupabaseOrderFilter = supabase.from("orders").select(select, { count: "exact" });
  request = applyOrderFilters(request, query, attentionOrderIds, fulfilmentOrderIds, includeOrderNumber);
  request = applyOrderSort(request, query.sort);
  return request;
}

async function listPageSummaries(orderIds: string[]) {
  if (!orderIds.length) {
    return { items: [], vehicles: [], fulfilments: [], emails: [] };
  }

  const supabase = getAdminOrThrow();
  const emailKeys = orderIds.map((orderId) => `order_confirmation:${orderId}`);
  const [itemsResult, vehiclesResult, fulfilmentsResult, emailsResult] = await Promise.all([
    supabase.from("order_items").select("order_id,sku,wiper_set_id").in("order_id", orderIds),
    supabase.from("order_vehicle_snapshots").select("order_id,make_snapshot,model_snapshot,year").in("order_id", orderIds),
    supabase
      .from("order_wiper_fulfillment")
      .select("order_id,connector_status,driver_length_in,passenger_length_in,rear_length_in,driver_connector,passenger_connector,rear_connector")
      .in("order_id", orderIds),
    supabase.from("email_events").select("order_id,dedupe_key,status,updated_at,created_at").in("dedupe_key", emailKeys)
  ]);

  if (itemsResult.error) throw itemsResult.error;
  if (vehiclesResult.error) throw vehiclesResult.error;
  if (fulfilmentsResult.error) throw fulfilmentsResult.error;
  if (emailsResult.error) throw emailsResult.error;

  return {
    items: ((itemsResult.data ?? []) as OrderItemRow[]).map(mapItemRow),
    vehicles: ((vehiclesResult.data ?? []) as VehicleRow[]).map(mapVehicleRow),
    fulfilments: ((fulfilmentsResult.data ?? []) as FulfilmentRow[]).map(mapFulfilmentRow),
    emails: ((emailsResult.data ?? []) as EmailRow[]).map(mapEmailRow).filter((event): event is NonNullable<ReturnType<typeof mapEmailRow>> => Boolean(event))
  };
}

async function listAttentionOrderIds({ stalePendingBefore }: { stalePendingBefore: string }) {
  const supabase = getAdminOrThrow();
  const [issueResult, fulfilmentsResult, emailResult, staleResult, wiperItemsResult] = await Promise.all([
    supabase.from("order_wiper_fulfillment").select("order_id").eq("connector_status", "issue"),
    supabase
      .from("order_wiper_fulfillment")
      .select("order_id,connector_status,driver_length_in,passenger_length_in,rear_length_in,driver_connector,passenger_connector,rear_connector"),
    supabase.from("email_events").select("order_id,dedupe_key").like("dedupe_key", "order_confirmation:%").in("status", failedEmailStatuses),
    supabase.from("orders").select("id").eq("status", "pending").lt("created_at", stalePendingBefore),
    supabase.from("order_items").select("order_id").not("wiper_set_id", "is", null)
  ]);

  if (issueResult.error) throw issueResult.error;
  if (fulfilmentsResult.error) throw fulfilmentsResult.error;
  if (emailResult.error) throw emailResult.error;
  if (staleResult.error) throw staleResult.error;
  if (wiperItemsResult.error) throw wiperItemsResult.error;

  const ids = new Set<string>();
  for (const row of (issueResult.data ?? []) as Array<{ order_id: string }>) ids.add(row.order_id);
  for (const row of ((fulfilmentsResult.data ?? []) as FulfilmentRow[]).map(mapFulfilmentRow)) {
    if (hasMissingRequiredAdapter(row)) ids.add(row.orderId);
  }
  for (const row of (emailResult.data ?? []) as EmailRow[]) {
    const orderId = row.order_id ?? getOrderIdFromConfirmationDedupeKey(row.dedupe_key);
    if (orderId) ids.add(orderId);
  }
  for (const row of (staleResult.data ?? []) as Array<{ id: string }>) ids.add(row.id);

  const wiperOrderIds = new Set(((wiperItemsResult.data ?? []) as Array<{ order_id: string }>).map((row) => row.order_id));
  if (wiperOrderIds.size) {
    const fulfilmentOrderIds = new Set(((fulfilmentsResult.data ?? []) as FulfilmentRow[]).map((row) => row.order_id));
    const { data, error } = await supabase.from("orders").select("id").eq("status", "paid").in("id", Array.from(wiperOrderIds));
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ id: string }>) {
      if (!fulfilmentOrderIds.has(row.id)) ids.add(row.id);
    }
  }

  return ids;
}

async function listOrderIdsByFulfilmentStatus(status: string) {
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase.from("order_wiper_fulfillment").select("order_id").eq("connector_status", status);
  if (error) throw error;
  return Array.from(new Set(((data ?? []) as Array<{ order_id: string }>).map((row) => row.order_id)));
}

function applyOrderFilters(request: SupabaseOrderFilter, query: AdminOrderListQuery, attentionOrderIds?: string[], fulfilmentOrderIds?: string[], includeOrderNumber = true) {
  let next = request;
  if (query.search) next = next.or(buildOrderSearchOrFilterWithOptions(query.search, { includeOrderNumber }));
  if (query.orderStatus) next = next.eq("status", query.orderStatus);
  if (query.dateFrom) next = next.gte("created_at", query.dateFrom);
  if (query.dateTo) next = next.lte("created_at", query.dateTo);
  if (attentionOrderIds) next = next.in("id", attentionOrderIds);
  if (fulfilmentOrderIds) next = next.in("id", fulfilmentOrderIds);
  return next;
}

function applyOrderSort(request: SupabaseOrderFilter, sort: AdminOrderListQuery["sort"]) {
  if (sort === "order_asc" || sort === "order_desc") {
    return request.order("order_number", { ascending: sort === "order_asc", nullsFirst: false }).order("created_at", { ascending: sort === "order_asc" });
  }

  return request.order("created_at", { ascending: sort === "created_asc" });
}

function mapOrderRow(row: OrderRow): AdminOrderRow {
  return {
    id: row.id,
    orderNumber: row.order_number ?? getOrderNumberFromSnapshot(row.id, row.items_snapshot ?? null),
    email: row.email,
    customerName: row.customer_name,
    customerProfileId: row.customer_profile_id,
    subtotal: Number(row.subtotal),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at
  };
}

function isMissingOrderNumberColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "42703" && typeof candidate.message === "string" && candidate.message.includes("order_number");
}

function mapItemRow(row: OrderItemRow): AdminOrderItemSummary {
  return { orderId: row.order_id, sku: row.sku, wiperSetId: row.wiper_set_id };
}

function mapVehicleRow(row: VehicleRow): AdminVehicleSummaryRow {
  return { orderId: row.order_id, make: row.make_snapshot, model: row.model_snapshot, year: row.year };
}

function mapFulfilmentRow(row: FulfilmentRow): AdminFulfilmentSummaryRow {
  return {
    orderId: row.order_id,
    status: row.connector_status,
    driverLengthIn: toNullableNumber(row.driver_length_in),
    passengerLengthIn: toNullableNumber(row.passenger_length_in),
    rearLengthIn: toNullableNumber(row.rear_length_in),
    driverConnector: row.driver_connector,
    passengerConnector: row.passenger_connector,
    rearConnector: row.rear_connector
  };
}

function mapEmailRow(row: EmailRow) {
  const orderId = row.order_id ?? getOrderIdFromConfirmationDedupeKey(row.dedupe_key);
  if (!orderId) return null;
  return { orderId, status: row.status, updatedAt: row.updated_at, createdAt: row.created_at };
}

function getOrderIdFromConfirmationDedupeKey(value: string | null) {
  const prefix = "order_confirmation:";
  return value?.startsWith(prefix) ? value.slice(prefix.length) : null;
}

function toNullableNumber(value: string | number | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getAdminOrThrow() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin orders.");
  return supabase;
}
