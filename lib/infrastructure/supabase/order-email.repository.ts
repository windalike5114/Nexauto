import type { FinalisedOrder } from "@/lib/application/orders/finalise-paid-order";
import type { OrderEmailService } from "@/lib/application/webhooks/process-stripe-event";
import { getNextRetryAt } from "@/lib/config/retry-policy";
import { sendOrderConfirmationEmail } from "@/lib/email/templates/order-confirmation";
import { createSupabaseAdminClient } from "@/lib/supabase";

export function createSupabaseOrderEmailService(): OrderEmailService {
  return {
    async sendOrderConfirmation(order) {
      if (!order.email) return "skipped";
      const claim = await claimEmail(order);

      if (claim.status !== "claimed") {
        return "skipped";
      }

      try {
        await sendOrderConfirmationEmail({
          orderId: order.orderId,
          emailEventId: claim.emailEventId,
          orderNumber: order.orderNumber,
          email: order.email,
          customerName: order.customerName,
          createdAt: new Date().toISOString(),
          currency: order.currency,
          subtotal: order.subtotal,
          total: order.total,
          status: "paid",
          shippingAddress: order.shippingAddress,
          billingAddress: order.billingAddress,
          items: order.items.map((item) => ({
            sku: item.sku,
            productName: item.product_name,
            qty: item.qty,
            unitPrice: item.unit_price,
            lineTotal: item.line_total,
            attributes: item.attributes
          })),
          vehicle: order.vehicle?.make && order.vehicle.model && order.vehicle.year
            ? {
                make: String(order.vehicle.make),
                model: String(order.vehicle.model),
                year: Number(order.vehicle.year)
              }
            : null
        });
        return "sent";
      } catch {
        await markEmailFailed(order.orderId);
        return "failed_retryable";
      }
    }
  };
}

async function claimEmail(order: FinalisedOrder) {
  const supabase = getAdmin();
  const { data, error } = await supabase.rpc("claim_email_event", {
    p_dedupe_key: `order_confirmation:${order.orderId}`,
    p_type: "order_confirmation",
    p_recipient: order.email ?? "",
    p_subject: `Order confirmed - #${order.orderNumber}`,
    p_order_id: order.orderId,
    p_customer_id: null,
    p_processing_lease: "10 minutes"
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: row?.claim_status as "claimed" | "already_sent" | "already_sending" | "not_claimed",
    emailEventId: row?.email_event_id as string | null
  };
}

async function markEmailFailed(orderId: string) {
  const supabase = getAdmin();
  const { data } = await supabase
    .from("email_events")
    .select("attempt_count")
    .eq("dedupe_key", `order_confirmation:${orderId}`)
    .maybeSingle();
  const attemptCount = Number(data?.attempt_count ?? 0);
  await supabase
    .from("email_events")
    .update({
      status: "failed_retryable",
      error_code: "Order confirmation email delivery failed",
      last_error_summary: "Order confirmation email delivery failed",
      next_retry_at: getNextRetryAt("email", attemptCount),
      updated_at: new Date().toISOString()
    })
    .eq("dedupe_key", `order_confirmation:${orderId}`);
}

function getAdmin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase service role key is not configured.");
  return supabase;
}
