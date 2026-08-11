import type {
  AdminOrderDetailAuditEventRow,
  AdminOrderDetailEmailEventRow,
  AdminOrderDetailFulfilmentRow,
  AdminOrderDetailItemRow,
  AdminOrderDetailOrderRow,
  AdminOrderDetailRepository,
  AdminOrderDetailSectionError,
  AdminOrderDetailVehicleSnapshotRow,
  AdminOrderDetailWebhookEventRow
} from "@/lib/application/admin/admin-order-detail.types";
import { getOrderNumberFromSnapshot } from "@/lib/order-number";
import { createSupabaseAdminClient } from "@/lib/supabase";

type SupabaseClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

type OrderRow = {
  id: string;
  order_number?: string | null;
  email: string | null;
  customer_name: string | null;
  customer_profile_id: string | null;
  subtotal: string | number;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  shipping_address: Record<string, unknown> | null;
  billing_address: Record<string, unknown> | null;
  items_snapshot: unknown;
  pricing_snapshot?: unknown;
  reward_state?: unknown;
};

type ItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  sku: string;
  product_name: string;
  attributes: Record<string, unknown> | null;
  qty: number;
  unit_price: string | number;
  line_subtotal: string | number | null;
  line_discount: string | number | null;
  line_total: string | number;
  vehicle_application_id: string | null;
  wiper_set_id: string | null;
  source_line_key?: string | null;
  vehicle_snapshot: Record<string, unknown> | null;
  product_snapshot: Record<string, unknown> | null;
  created_at: string | null;
};

type VehicleRow = {
  id: string;
  order_id: string;
  vehicle_application_id: string | null;
  customer_vehicle_id: string | null;
  make_snapshot: string | null;
  model_snapshot: string | null;
  year: number | null;
  start_raw: string | null;
  end_raw: string | null;
  created_at: string | null;
};

type FulfilmentRow = {
  id: string;
  order_id: string;
  order_item_id: string | null;
  vehicle_application_id: string | null;
  wiper_set_id: string | null;
  driver_length_in: string | number | null;
  passenger_length_in: string | number | null;
  rear_length_in: string | number | null;
  driver_connector: string | null;
  passenger_connector: string | null;
  rear_connector: string | null;
  connector_status: string;
  admin_note: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type EmailRow = {
  id: string;
  type: string;
  recipient: string;
  subject: string | null;
  status: string;
  error_code: string | null;
  resend_email_id: string | null;
  dedupe_key: string | null;
  order_id: string | null;
  attempt_count: number | null;
  next_retry_at: string | null;
  last_error_summary: string | null;
  created_at: string;
  sent_at: string | null;
  updated_at: string | null;
};

type WebhookRow = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  first_received_at: string;
  last_attempted_at: string | null;
  processed_at: string | null;
  related_order_id: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  error_summary: string | null;
  retryable: boolean | null;
};

type AuditRow = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const orderSelect =
  "id,order_number,email,customer_name,customer_profile_id,subtotal,currency,status,created_at,updated_at,stripe_session_id,stripe_payment_intent_id,shipping_address,billing_address,items_snapshot,pricing_snapshot,reward_state";
const legacyOrderSelect =
  "id,email,customer_name,customer_profile_id,subtotal,currency,status,created_at,updated_at,stripe_session_id,stripe_payment_intent_id,shipping_address,billing_address,items_snapshot";

export function createAdminOrderDetailRepository(): AdminOrderDetailRepository {
  return {
    async loadOrderDetail(orderId) {
      const supabase = getAdmin();
      const order = await loadOrder(supabase, orderId);
      if (!order) {
        return {
          order: null,
          items: [],
          vehicleSnapshots: [],
          fulfilments: [],
          emailEvents: [],
          webhookEvents: [],
          auditEvents: [],
          sectionErrors: []
        };
      }

      const [items, vehicles, fulfilments, emailResult, webhookResult, auditResult] = await Promise.all([
        loadItems(supabase, orderId),
        loadVehicleSnapshots(supabase, orderId),
        loadFulfilments(supabase, orderId),
        loadEmailEventsSafe(supabase, orderId),
        loadWebhookEventsSafe(supabase, order),
        loadAuditEventsSafe(supabase, orderId)
      ]);

      return {
        order,
        items,
        vehicleSnapshots: vehicles,
        fulfilments,
        emailEvents: emailResult.rows,
        webhookEvents: webhookResult.rows,
        auditEvents: auditResult.rows,
        sectionErrors: [...emailResult.errors, ...webhookResult.errors, ...auditResult.errors]
      };
    }
  };
}

async function loadOrder(supabase: SupabaseClient, orderId: string): Promise<AdminOrderDetailOrderRow | null> {
  const initial = await supabase.from("orders").select(orderSelect).eq("id", orderId).maybeSingle();
  let data: unknown = initial.data;
  let error: typeof initial.error = initial.error;
  if (isMissingColumn(error, "order_number") || isMissingColumn(error, "pricing_snapshot") || isMissingColumn(error, "reward_state")) {
    const fallback = await supabase.from("orders").select(legacyOrderSelect).eq("id", orderId).maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  if (!data) return null;
  return mapOrder(data as OrderRow);
}

async function loadItems(supabase: SupabaseClient, orderId: string) {
  const select =
    "id,order_id,product_id,variant_id,sku,product_name,attributes,qty,unit_price,line_subtotal,line_discount,line_total,vehicle_application_id,wiper_set_id,source_line_key,vehicle_snapshot,product_snapshot,created_at";
  const initial = await supabase.from("order_items").select(select).eq("order_id", orderId).order("created_at", { ascending: true });
  let data: unknown = initial.data;
  let error: typeof initial.error = initial.error;
  if (isMissingColumn(error, "source_line_key")) {
    const fallbackSelect =
      "id,order_id,product_id,variant_id,sku,product_name,attributes,qty,unit_price,line_subtotal,line_discount,line_total,vehicle_application_id,wiper_set_id,vehicle_snapshot,product_snapshot,created_at";
    const fallback = await supabase.from("order_items").select(fallbackSelect).eq("order_id", orderId).order("created_at", { ascending: true });
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  return ((data ?? []) as ItemRow[]).map(mapItem);
}

async function loadVehicleSnapshots(supabase: SupabaseClient, orderId: string) {
  const { data, error } = await supabase
    .from("order_vehicle_snapshots")
    .select("id,order_id,vehicle_application_id,customer_vehicle_id,make_snapshot,model_snapshot,year,start_raw,end_raw,created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as VehicleRow[]).map(mapVehicle);
}

async function loadFulfilments(supabase: SupabaseClient, orderId: string) {
  const { data, error } = await supabase
    .from("order_wiper_fulfillment")
    .select(
      "id,order_id,order_item_id,vehicle_application_id,wiper_set_id,driver_length_in,passenger_length_in,rear_length_in,driver_connector,passenger_connector,rear_connector,connector_status,admin_note,created_at,updated_at"
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as FulfilmentRow[]).map(mapFulfilment);
}

async function loadEmailEventsSafe(supabase: SupabaseClient, orderId: string): Promise<{ rows: AdminOrderDetailEmailEventRow[]; errors: AdminOrderDetailSectionError[] }> {
  const dedupeKey = `order_confirmation:${orderId}`;
  const { data, error } = await supabase
    .from("email_events")
    .select("id,type,recipient,subject,status,error_code,resend_email_id,dedupe_key,order_id,attempt_count,next_retry_at,last_error_summary,created_at,sent_at,updated_at")
    .or(`dedupe_key.eq.${dedupeKey},order_id.eq.${orderId}`)
    .order("updated_at", { ascending: false });
  if (isMissingTable(error, "email_events") || error) {
    return { rows: [], errors: [sectionError("email", "Email history unavailable", "Email lifecycle records could not be loaded for this order.")] };
  }
  return { rows: ((data ?? []) as EmailRow[]).map(mapEmail), errors: [] };
}

async function loadWebhookEventsSafe(
  supabase: SupabaseClient,
  order: AdminOrderDetailOrderRow
): Promise<{ rows: AdminOrderDetailWebhookEventRow[]; errors: AdminOrderDetailSectionError[] }> {
  const filters = [`related_order_id.eq.${order.id}`];
  if (order.stripeSessionId) filters.push(`stripe_session_id.eq.${order.stripeSessionId}`);
  if (order.stripePaymentIntentId) filters.push(`stripe_payment_intent_id.eq.${order.stripePaymentIntentId}`);

  const { data, error } = await supabase
    .from("stripe_webhook_events")
    .select("id,stripe_event_id,event_type,status,attempt_count,first_received_at,last_attempted_at,processed_at,related_order_id,stripe_session_id,stripe_payment_intent_id,error_summary,retryable")
    .or(filters.join(","))
    .order("first_received_at", { ascending: false });
  if (isMissingTable(error, "stripe_webhook_events") || error) {
    return { rows: [], errors: [sectionError("webhook", "Webhook history unavailable", "Stripe webhook records could not be loaded for this order.")] };
  }
  return { rows: ((data ?? []) as WebhookRow[]).map(mapWebhook), errors: [] };
}

async function loadAuditEventsSafe(supabase: SupabaseClient, orderId: string): Promise<{ rows: AdminOrderDetailAuditEventRow[]; errors: AdminOrderDetailSectionError[] }> {
  const { data, error } = await supabase
    .from("system_audit_events")
    .select("id,event_type,entity_type,entity_id,actor_type,actor_id,summary,metadata,created_at")
    .eq("entity_id", orderId)
    .order("created_at", { ascending: false });
  if (isMissingTable(error, "system_audit_events") || error) {
    return { rows: [], errors: [sectionError("audit", "Audit timeline unavailable", "Recovery and audit records could not be loaded for this order.")] };
  }
  return { rows: ((data ?? []) as AuditRow[]).map(mapAudit), errors: [] };
}

function mapOrder(row: OrderRow): AdminOrderDetailOrderRow {
  return {
    id: row.id,
    orderNumber: row.order_number ?? null,
    legacyOrderNumber: getOrderNumberFromSnapshot(row.items_snapshot) ?? "Order number pending",
    email: row.email,
    customerName: row.customer_name,
    customerProfileId: row.customer_profile_id,
    subtotal: Number(row.subtotal),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stripeSessionId: row.stripe_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    shippingAddress: row.shipping_address ?? {},
    billingAddress: row.billing_address ?? {},
    itemsSnapshot: row.items_snapshot,
    pricingSnapshot: row.pricing_snapshot ?? null,
    rewardState: row.reward_state ?? null
  };
}

function mapItem(row: ItemRow): AdminOrderDetailItemRow {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    variantId: row.variant_id,
    sku: row.sku,
    productName: row.product_name,
    attributes: row.attributes ?? {},
    qty: row.qty,
    unitPrice: Number(row.unit_price),
    lineSubtotal: toNullableNumber(row.line_subtotal),
    lineDiscount: toNullableNumber(row.line_discount),
    lineTotal: Number(row.line_total),
    vehicleApplicationId: row.vehicle_application_id,
    wiperSetId: row.wiper_set_id,
    sourceLineKey: row.source_line_key ?? null,
    vehicleSnapshot: row.vehicle_snapshot ?? {},
    productSnapshot: row.product_snapshot ?? {},
    createdAt: row.created_at
  };
}

function mapVehicle(row: VehicleRow): AdminOrderDetailVehicleSnapshotRow {
  return {
    id: row.id,
    orderId: row.order_id,
    vehicleApplicationId: row.vehicle_application_id,
    customerVehicleId: row.customer_vehicle_id,
    make: row.make_snapshot,
    model: row.model_snapshot,
    year: row.year,
    startRaw: row.start_raw,
    endRaw: row.end_raw,
    createdAt: row.created_at
  };
}

function mapFulfilment(row: FulfilmentRow): AdminOrderDetailFulfilmentRow {
  return {
    id: row.id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    vehicleApplicationId: row.vehicle_application_id,
    wiperSetId: row.wiper_set_id,
    driverLengthIn: toNullableNumber(row.driver_length_in),
    passengerLengthIn: toNullableNumber(row.passenger_length_in),
    rearLengthIn: toNullableNumber(row.rear_length_in),
    driverConnector: row.driver_connector,
    passengerConnector: row.passenger_connector,
    rearConnector: row.rear_connector,
    connectorStatus: row.connector_status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEmail(row: EmailRow): AdminOrderDetailEmailEventRow {
  return {
    id: row.id,
    type: row.type,
    recipient: row.recipient,
    subject: row.subject,
    status: row.status,
    errorCode: row.error_code,
    resendEmailId: row.resend_email_id,
    dedupeKey: row.dedupe_key,
    orderId: row.order_id,
    attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at,
    lastErrorSummary: row.last_error_summary,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    updatedAt: row.updated_at
  };
}

function mapWebhook(row: WebhookRow): AdminOrderDetailWebhookEventRow {
  return {
    id: row.id,
    stripeEventId: row.stripe_event_id,
    eventType: row.event_type,
    status: row.status,
    attemptCount: row.attempt_count,
    firstReceivedAt: row.first_received_at,
    lastAttemptedAt: row.last_attempted_at,
    processedAt: row.processed_at,
    relatedOrderId: row.related_order_id,
    stripeSessionId: row.stripe_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    errorSummary: row.error_summary,
    retryable: row.retryable ?? false
  };
}

function mapAudit(row: AuditRow): AdminOrderDetailAuditEventRow {
  return {
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    summary: row.summary,
    metadata: row.metadata ?? {},
    createdAt: row.created_at
  };
}

function sectionError(section: AdminOrderDetailSectionError["section"], title: string, message: string): AdminOrderDetailSectionError {
  return { section, title, message };
}

function toNullableNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isMissingColumn(error: { code?: string; message?: string } | null, column: string) {
  return Boolean(error && error.code === "42703" && error.message?.includes(column));
}

function isMissingTable(error: { code?: string; message?: string } | null, table: string) {
  return Boolean(error && (error.code === "42P01" || error.message?.includes(table)));
}

function getAdmin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin order detail.");
  return supabase;
}
