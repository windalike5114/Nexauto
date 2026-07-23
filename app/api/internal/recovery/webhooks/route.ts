import { NextResponse } from "next/server";
import Stripe from "stripe";
import { assertInternalRecoveryAccess } from "@/lib/application/recovery/internal-auth";
import { listRecoverableWebhookEvents } from "@/lib/application/webhooks/list-recoverable-webhook-events";
import { retryStripeWebhookEvent } from "@/lib/application/webhooks/retry-stripe-webhook-event";
import { retryPolicy } from "@/lib/config/retry-policy";
import { writeSystemAuditEvent } from "@/lib/infrastructure/supabase/audit.repository";
import { createSupabaseOrderEmailService } from "@/lib/infrastructure/supabase/order-email.repository";
import { createSupabaseOrderFinalisationRepository } from "@/lib/infrastructure/supabase/order-finalisation.repository";
import { createSupabaseStripeWebhookEventRepository } from "@/lib/infrastructure/supabase/stripe-webhook-event.repository";
import { createSupabaseWebhookRecoveryRepository } from "@/lib/infrastructure/supabase/webhook-recovery.repository";
import { createWebhookCustomerEnrichmentService } from "@/lib/infrastructure/supabase/webhook-customer-enrichment";
import { createStripeEventRetrieval } from "@/lib/infrastructure/stripe/event-retrieval";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = assertInternalRecoveryAccess(request);
  if (unauthorized) return unauthorized;

  const repository = createSupabaseWebhookRecoveryRepository();
  const events = await listRecoverableWebhookEvents({ limit: retryPolicy.batchLimit }, { repository });
  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  const unauthorized = assertInternalRecoveryAccess(request);
  if (unauthorized) return unauthorized;
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const body = await safeJson(request);
  const stripeEventIds = Array.isArray(body?.stripeEventIds)
    ? body.stripeEventIds.map(String).filter(Boolean).slice(0, retryPolicy.batchLimit)
    : body?.stripeEventId
      ? [String(body.stripeEventId)]
      : [];

  if (!stripeEventIds.length) return NextResponse.json({ error: "stripeEventId is required." }, { status: 400 });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const results = [];
  for (const stripeEventId of stripeEventIds) {
    try {
      const result = await retryStripeWebhookEvent(
        { stripeEventId },
        {
          recovery: createSupabaseWebhookRecoveryRepository(),
          stripeEvents: createStripeEventRetrieval(stripe),
          events: createSupabaseStripeWebhookEventRepository(),
          orders: createSupabaseOrderFinalisationRepository(),
          customers: createWebhookCustomerEnrichmentService(),
          emails: createSupabaseOrderEmailService(),
          logger: console
        }
      );
      await writeSystemAuditEvent({
        eventType: "webhook_retry",
        entityType: "stripe_webhook_event",
        entityId: stripeEventId,
        actorType: "system",
        summary: "Webhook recovery retry executed.",
        metadata: { result: result.status }
      });
      results.push({ stripeEventId, status: result.status });
    } catch {
      results.push({ stripeEventId, status: "failed" });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}

async function safeJson(request: Request) {
  try {
    return (await request.json()) as { stripeEventId?: unknown; stripeEventIds?: unknown[] };
  } catch {
    return null;
  }
}
