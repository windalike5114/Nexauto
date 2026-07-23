import Stripe from "stripe";
import type { PaymentReconciliationRepository } from "@/lib/application/reconciliation/reconcile-order-payment";
import { createSupabaseAdminClient } from "@/lib/supabase";

export function createPaymentReconciliationRepository(stripe: Stripe): PaymentReconciliationRepository {
  return {
    async findOrder(input) {
      let query = getAdmin()
        .from("orders")
        .select("id,status,subtotal,currency,stripe_session_id,stripe_payment_intent_id")
        .limit(1);
      if (input.orderId) query = query.eq("id", input.orderId);
      else if (input.stripeSessionId) query = query.eq("stripe_session_id", input.stripeSessionId);
      else return null;

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        status: data.status,
        subtotal: Number(data.subtotal),
        currency: data.currency,
        stripeSessionId: data.stripe_session_id,
        stripePaymentIntentId: data.stripe_payment_intent_id
      };
    },

    async retrieveStripeSession(stripeSessionId) {
      const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
      return {
        id: session.id,
        status: session.status ?? null,
        paymentStatus: session.payment_status ?? null,
        amountTotalMinor: session.amount_total ?? null,
        currency: session.currency ?? null,
        paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null
      };
    }
  };
}

function getAdmin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase service role key is not configured.");
  return supabase;
}
