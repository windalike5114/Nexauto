import type { FinalisedOrder, PendingOrderSnapshotItem } from "@/lib/application/orders/finalise-paid-order";
import type { OrderEmailRetryRepository } from "@/lib/application/email/retry-order-confirmation-email";
import { getNextRetryAt, retryPolicy } from "@/lib/config/retry-policy";
import { getOrderNumberFromSnapshot } from "@/lib/order-number";
import { createSupabaseAdminClient } from "@/lib/supabase";

type EmailRetryRow = {
  id: string;
  dedupe_key: string;
  order_id: string;
  attempt_count: number | null;
};

export function createSupabaseOrderEmailRetryRepository(): OrderEmailRetryRepository {
  return {
    async claimRetryableOrderConfirmation(input) {
      const supabase = getAdmin();
      let query = supabase
        .from("email_events")
        .select("id,dedupe_key,order_id,attempt_count")
        .eq("type", "order_confirmation")
        .in("status", ["failed", "failed_retryable"])
        .order("updated_at", { ascending: true })
        .limit(1);

      if (input.emailEventId) query = query.eq("id", input.emailEventId);
      if (input.orderId) query = query.eq("order_id", input.orderId);

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data?.order_id || !data.dedupe_key) return null;

      const row = data as EmailRetryRow;
      const attemptCount = Number(row.attempt_count ?? 0);
      if (attemptCount >= retryPolicy.maxApplicationAttempts) return null;

      const { data: claimed, error: claimError } = await supabase
        .from("email_events")
        .update({
          status: "sending",
          attempt_count: attemptCount + 1,
          last_attempted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id)
        .in("status", ["failed", "failed_retryable"])
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) return null;

      const order = await loadFinalisedOrder(row.order_id);
      if (!order || order.status !== "paid" || !order.email) return null;

      return {
        emailEventId: row.id,
        dedupeKey: row.dedupe_key,
        attemptCount: attemptCount + 1,
        order: toFinalisedOrder(order)
      };
    },

    async markRetrySent(input) {
      const { error } = await getAdmin()
        .from("email_events")
        .update({
          status: "sent",
          resend_email_id: input.resendEmailId ?? undefined,
          sent_at: new Date().toISOString(),
          error_code: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", input.emailEventId);
      if (error) throw error;
    },

    async markRetryFailed(input) {
      const { data } = await getAdmin().from("email_events").select("attempt_count").eq("id", input.emailEventId).maybeSingle();
      const attemptCount = Number(data?.attempt_count ?? 0);
      const { error } = await getAdmin()
        .from("email_events")
        .update({
          status: input.retryable ? "failed_retryable" : "failed",
          error_code: input.errorSummary.slice(0, 500),
          next_retry_at: input.retryable ? getNextRetryAt("email", attemptCount) : null,
          updated_at: new Date().toISOString()
        })
        .eq("id", input.emailEventId);
      if (error) throw error;
    }
  };
}

async function loadFinalisedOrder(orderId: string) {
  const { data, error } = await getAdmin()
    .from("orders")
    .select("id,email,customer_name,subtotal,currency,status,shipping_address,billing_address,items_snapshot")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data as null | {
    id: string;
    email: string | null;
    customer_name: string | null;
    subtotal: string | number;
    currency: string;
    status: string;
    shipping_address: Record<string, unknown> | null;
    billing_address: Record<string, unknown> | null;
    items_snapshot: { items?: PendingOrderSnapshotItem[]; vehicle?: FinalisedOrder["vehicle"]; order_number?: string } | null;
  };
}

function toFinalisedOrder(order: NonNullable<Awaited<ReturnType<typeof loadFinalisedOrder>>>): FinalisedOrder {
  const snapshot = order.items_snapshot ?? {};
  return {
    orderId: order.id,
    orderNumber: snapshot.order_number ?? getOrderNumberFromSnapshot(order.id, snapshot),
    email: order.email,
    customerName: order.customer_name,
    subtotal: Number(order.subtotal),
    total: Number(order.subtotal),
    currency: order.currency,
    items: snapshot.items ?? [],
    vehicle: snapshot.vehicle ?? null,
    shippingAddress: order.shipping_address ?? {},
    billingAddress: order.billing_address ?? {}
  };
}

function getAdmin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase service role key is not configured.");
  return supabase;
}
