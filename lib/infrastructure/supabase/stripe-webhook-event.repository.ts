import type { StripeWebhookEventRepository, WebhookEventClaim } from "@/lib/application/webhooks/process-stripe-event";
import { createSupabaseAdminClient } from "@/lib/supabase";

export function createSupabaseStripeWebhookEventRepository(): StripeWebhookEventRepository {
  return {
    async claimEvent(input) {
      const supabase = getAdmin();
      const { data, error } = await supabase.rpc("claim_stripe_webhook_event", {
        p_stripe_event_id: input.stripeEventId,
        p_event_type: input.eventType,
        p_stripe_session_id: input.stripeSessionId ?? null,
        p_stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
        p_processing_lease: `${input.processingLeaseMinutes} minutes`
      });

      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        claimStatus: row.claim_status,
        eventId: row.event_id,
        currentStatus: row.current_status
      } as WebhookEventClaim;
    },

    async completeEvent(input) {
      const supabase = getAdmin();
      const { error } = await supabase.rpc("complete_stripe_webhook_event", {
        p_stripe_event_id: input.stripeEventId,
        p_status: input.status,
        p_related_order_id: input.relatedOrderId ?? null,
        p_error_summary: input.errorSummary ?? null,
        p_retryable: input.retryable
      });

      if (error) throw error;
    }
  };
}

function getAdmin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase service role key is not configured.");
  return supabase;
}
