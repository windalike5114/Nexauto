import type { RecoverableWebhookRepository } from "@/lib/application/webhooks/list-recoverable-webhook-events";
import type { StripeWebhookRecoveryRepository } from "@/lib/application/webhooks/retry-stripe-webhook-event";
import { retryPolicy } from "@/lib/config/retry-policy";
import { createSupabaseAdminClient } from "@/lib/supabase";

export function createSupabaseWebhookRecoveryRepository(): RecoverableWebhookRepository & StripeWebhookRecoveryRepository {
  return {
    async listRecoverableWebhookEvents(input) {
      const staleBefore = new Date(Date.now() - retryPolicy.processingLeaseMinutes * 60_000).toISOString();
      const { data, error } = await getAdmin()
        .from("stripe_webhook_events")
        .select("id,stripe_event_id,event_type,status,attempt_count,last_attempted_at,error_summary")
        .or(`status.eq.failed_retryable,and(status.eq.processing,last_attempted_at.lt.${staleBefore})`)
        .order("last_attempted_at", { ascending: true })
        .limit(input.limit);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        stripeEventId: row.stripe_event_id,
        eventType: row.event_type,
        status: row.status,
        attemptCount: Number(row.attempt_count ?? 0),
        lastAttemptedAt: row.last_attempted_at,
        errorSummary: row.error_summary
      }));
    },

    async canRetryWebhookEvent(stripeEventId) {
      const { data, error } = await getAdmin()
        .from("stripe_webhook_events")
        .select("status,last_attempted_at,attempt_count")
        .eq("stripe_event_id", stripeEventId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { ok: false, reason: "Webhook event was not found." };
      if (data.status === "failed_retryable") return { ok: true };
      if (data.status === "processing") {
        const lastAttempted = data.last_attempted_at ? new Date(data.last_attempted_at).getTime() : 0;
        if (lastAttempted < Date.now() - retryPolicy.processingLeaseMinutes * 60_000) return { ok: true };
      }
      return { ok: false, reason: `Webhook event status ${data.status} is not retryable.` };
    }
  };
}

function getAdmin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase service role key is not configured.");
  return supabase;
}
