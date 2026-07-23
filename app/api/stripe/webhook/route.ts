import { NextResponse } from "next/server";
import Stripe from "stripe";
import { processStripeEvent } from "@/lib/application/webhooks/process-stripe-event";
import { constructStripeWebhookEvent } from "@/lib/infrastructure/stripe/stripe-webhook.adapter";
import { createSupabaseOrderFinalisationRepository } from "@/lib/infrastructure/supabase/order-finalisation.repository";
import { createSupabaseOrderEmailService } from "@/lib/infrastructure/supabase/order-email.repository";
import { createSupabaseStripeWebhookEventRepository } from "@/lib/infrastructure/supabase/stripe-webhook-event.repository";
import { createWebhookCustomerEnrichmentService } from "@/lib/infrastructure/supabase/webhook-customer-enrichment";

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  let command;

  try {
    command = constructStripeWebhookEvent(new Stripe(secretKey), rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  const result = await processStripeEvent(command, {
    events: createSupabaseStripeWebhookEventRepository(),
    orders: createSupabaseOrderFinalisationRepository(),
    customers: createWebhookCustomerEnrichmentService(),
    emails: createSupabaseOrderEmailService(),
    logger: console
  });

  return NextResponse.json(result);
}
