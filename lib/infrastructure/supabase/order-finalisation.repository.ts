import type {
  FinalisableOrder,
  FinalisedOrder,
  OrderFinalisationInput,
  PendingOrderSnapshot,
  PendingOrderSnapshotItem
} from "@/lib/application/orders/finalise-paid-order";
import type { OrderFinalisationRepository } from "@/lib/application/webhooks/process-stripe-event";
import { isLooseUuid } from "@/lib/domain/shared/uuid";
import { getOrderNumberFromSnapshot } from "@/lib/order-number";
import { createSupabaseAdminClient } from "@/lib/supabase";

type OrderRow = {
  id: string;
  email: string | null;
  customer_name: string | null;
  subtotal: string | number;
  currency: string;
  status: string;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  items_snapshot: unknown;
};

export function createSupabaseOrderFinalisationRepository(): OrderFinalisationRepository {
  return {
    async findOrderByStripeIdentifiers(input) {
      const supabase = getAdmin();
      const selectors: Array<["id" | "stripe_session_id" | "stripe_payment_intent_id", string]> = [];
      if (input.orderId && isLooseUuid(input.orderId)) selectors.push(["id", input.orderId]);
      if (input.stripeSessionId) selectors.push(["stripe_session_id", input.stripeSessionId]);
      if (input.stripePaymentIntentId) selectors.push(["stripe_payment_intent_id", input.stripePaymentIntentId]);

      for (const [column, value] of selectors) {
        const { data, error } = await supabase
          .from("orders")
          .select("id,email,customer_name,subtotal,currency,status,stripe_session_id,stripe_payment_intent_id,items_snapshot")
          .eq(column, value)
          .maybeSingle();
        if (error) throw error;
        if (data) return mapOrder(data as OrderRow);
      }

      return null;
    },

    async finalisePaidOrder(input) {
      const supabase = getAdmin();
      const orderNumber = getOrderNumberFromSnapshot(input.order.id, input.order.itemsSnapshot);
      const items = input.order.itemsSnapshot.items ?? [];
      const session = input.session;
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      const stripeSnapshot = {
        session_id: session.id,
        payment_intent_id: paymentIntentId,
        invoice_id: input.invoice?.id ?? null,
        invoice_url: input.invoice?.hostedInvoiceUrl ?? null,
        amount_subtotal: session.amount_subtotal ? session.amount_subtotal / 100 : null,
        amount_total: session.amount_total ? session.amount_total / 100 : null,
        payment_status: session.payment_status
      };
      const finalSnapshot = {
        ...input.order.itemsSnapshot,
        order_number: orderNumber,
        stripe: stripeSnapshot,
        checkout_state: "paid"
      };
      const { error: orderError } = await supabase
        .from("orders")
        .update({
          email: session.customer_details?.email ?? session.customer_email ?? input.order.email,
          customer_name: session.customer_details?.name ?? input.order.customerName,
          shipping_address: session.shipping_details?.address ?? {},
          billing_address: session.customer_details?.address ?? {},
          items_snapshot: finalSnapshot,
          pricing_snapshot: finalSnapshot.pricing ?? null,
          reward_state: finalSnapshot.reward_state ?? null,
          subtotal: session.amount_total ? session.amount_total / 100 : input.order.subtotal,
          currency: session.currency ?? input.order.currency,
          status: "paid",
          stripe_session_id: session.id,
          stripe_payment_intent_id: paymentIntentId,
          updated_at: new Date().toISOString()
        })
        .eq("id", input.order.id);

      if (orderError) throw orderError;

      await upsertOrderItems(supabase, input.order.id, items, input.sourceLineKeys);
      const insertedItems = await loadExistingOrderItems(supabase, input.order.id);
      await insertVehicleSnapshotIfNeeded(supabase, input.order.id, input.order.itemsSnapshot.vehicle);
      await insertFulfilmentIfNeeded(supabase, input.order.id, items, insertedItems, input.order.itemsSnapshot.vehicle);

      return {
        orderId: input.order.id,
        orderNumber,
        email: session.customer_details?.email ?? session.customer_email ?? input.order.email,
        customerName: session.customer_details?.name ?? input.order.customerName,
        subtotal: items.reduce((sum, item) => sum + Number(item.line_total), 0),
        total: session.amount_total ? session.amount_total / 100 : input.order.subtotal,
        currency: session.currency ?? input.order.currency,
        items,
        vehicle: input.order.itemsSnapshot.vehicle,
        shippingAddress: (session.shipping_details?.address ?? {}) as Record<string, unknown>,
        billingAddress: (session.customer_details?.address ?? {}) as Record<string, unknown>
      };
    },

    async markCheckoutExpired(input) {
      const supabase = getAdmin();
      const order = await this.findOrderByStripeIdentifiers({ orderId: input.orderId, stripeSessionId: input.stripeSessionId });
      if (!order || order.status !== "pending") return;
      const { error } = await supabase
        .from("orders")
        .update({
          items_snapshot: {
            ...order.itemsSnapshot,
            checkout_state: "checkout_expired"
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", order.id);
      if (error) throw error;
    },

    async markPaymentFailed(input) {
      const supabase = getAdmin();
      const order = await this.findOrderByStripeIdentifiers(input);
      if (!order || order.status === "paid") return;
      const { error } = await supabase
        .from("orders")
        .update({
          status: "failed",
          items_snapshot: {
            ...order.itemsSnapshot,
            checkout_state: "payment_failed",
            payment_failure_reason: input.reason
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", order.id);
      if (error) throw error;
    }
  };
}

async function upsertOrderItems(supabase: ReturnType<typeof getAdmin>, orderId: string, items: PendingOrderSnapshotItem[], sourceLineKeys: string[]) {
  const rows = items.map((item, index) => ({
    order_id: orderId,
    product_id: isLooseUuid(item.product_id) ? item.product_id : null,
    variant_id: isLooseUuid(item.variant_id) ? item.variant_id : null,
    sku: item.sku,
    product_name: item.product_name,
    attributes: {
      ...item.attributes,
      logical_product_id: item.product_id,
      logical_variant_id: item.variant_id,
      finalisation_line_key: sourceLineKeys[index]
    },
    qty: item.qty,
    unit_price: item.unit_price,
    line_subtotal: item.line_subtotal ?? item.unit_price * item.qty,
    line_discount: item.line_discount ?? item.bundle_discount ?? 0,
    line_total: item.line_total,
    source_line_key: sourceLineKeys[index],
    vehicle_application_id: getVehicleApplicationId(item),
    wiper_set_id: item.product_id === "wiper_set" && isLooseUuid(item.variant_id) ? item.variant_id : null,
    vehicle_snapshot: item.vehicle_snapshot ?? buildVehicleSnapshot(item),
    product_snapshot: item.product_snapshot ?? buildProductSnapshot(item)
  }));

  const { error } = await supabase.from("order_items").upsert(rows, {
    onConflict: "order_id,source_line_key",
    ignoreDuplicates: true
  });

  if (error) throw error;
}

async function loadExistingOrderItems(supabase: ReturnType<typeof getAdmin>, orderId: string) {
  const { data, error } = await supabase.from("order_items").select("id,sku,attributes").eq("order_id", orderId);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; sku: string; attributes: Record<string, string | number> }>;
}

async function insertVehicleSnapshotIfNeeded(supabase: ReturnType<typeof getAdmin>, orderId: string, vehicle: PendingOrderSnapshot["vehicle"]) {
  if (!vehicle?.make || !vehicle.model || !vehicle.year) return;
  const { data, error: existingError } = await supabase.from("order_vehicle_snapshots").select("id").eq("order_id", orderId).limit(1);
  if (existingError) throw existingError;
  if (data?.length) return;

  const { error } = await supabase.from("order_vehicle_snapshots").insert({
    order_id: orderId,
    vehicle_application_id: typeof vehicle.a === "string" && isLooseUuid(vehicle.a) ? vehicle.a : null,
    make_snapshot: String(vehicle.make),
    model_snapshot: String(vehicle.model),
    year: Number(vehicle.year)
  });
  if (error) throw error;
}

async function insertFulfilmentIfNeeded(
  supabase: ReturnType<typeof getAdmin>,
  orderId: string,
  items: PendingOrderSnapshotItem[],
  insertedItems: Array<{ id: string; sku: string; attributes: Record<string, string | number> }>,
  vehicle: PendingOrderSnapshot["vehicle"]
) {
  const { data, error: existingError } = await supabase.from("order_wiper_fulfillment").select("id").eq("order_id", orderId).limit(1);
  if (existingError) throw existingError;
  if (data?.length) return;

  const insertedByLine = new Map(insertedItems.map((item) => [String(item.attributes.finalisation_line_key ?? ""), item]));
  const rearLength = items.find((item) => item.product_id === "wiper_rear_addon")?.attributes.rear_length;
  const rows = items
    .filter((item) => item.product_id === "wiper_set")
    .map((item) => {
      const lineKey = String(item.attributes.finalisation_line_key ?? item.attributes.source_line_key ?? "");
      const orderItem = insertedByLine.get(lineKey);
      return {
        order_id: orderId,
        order_item_id: orderItem?.id ?? null,
        vehicle_application_id: getVehicleApplicationId(item),
        wiper_set_id: isLooseUuid(item.variant_id) ? item.variant_id : null,
        driver_length_in: parseLength(item.attributes.driver_length),
        passenger_length_in: parseLength(item.attributes.passenger_length),
        rear_length_in: parseLength(rearLength),
        connector_status: "pending"
      };
    });

  if (!rows.length) return;
  const { error } = await supabase.from("order_wiper_fulfillment").insert(rows);
  if (error) throw error;
}

function mapOrder(row: OrderRow): FinalisableOrder {
  return {
    id: row.id,
    email: row.email,
    customerName: row.customer_name,
    subtotal: Number(row.subtotal),
    currency: row.currency,
    status: row.status,
    stripeSessionId: row.stripe_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    itemsSnapshot: normalizeSnapshot(row.items_snapshot)
  };
}

function normalizeSnapshot(value: unknown): PendingOrderSnapshot {
  if (!value || typeof value !== "object") return {};
  return value as PendingOrderSnapshot;
}

function parseLength(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(String(value).replace(/"/g, ""));
  return Number.isFinite(number) ? number : null;
}

function getAdmin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase service role key is not configured.");
  return supabase;
}

function getVehicleApplicationId(item: PendingOrderSnapshotItem) {
  const value = item.vehicle_application_id ?? item.attributes.vehicle_application_id;
  return typeof value === "string" && isLooseUuid(value) ? value : null;
}

function buildVehicleSnapshot(item: PendingOrderSnapshotItem) {
  return {
    vehicle_application_id: getVehicleApplicationId(item),
    make: item.attributes.vehicle_make ?? null,
    model: item.attributes.vehicle_model ?? null,
    year: item.attributes.vehicle_year ?? null,
    label: item.attributes.vehicle ?? null,
    driver_length: item.attributes.driver_length ?? null,
    passenger_length: item.attributes.passenger_length ?? null,
    rear_length: item.attributes.rear_length ?? null
  };
}

function buildProductSnapshot(item: PendingOrderSnapshotItem) {
  return {
    product_id: item.product_id,
    variant_id: item.variant_id,
    sku: item.sku,
    name: item.product_name,
    attributes: item.attributes
  };
}
