import Stripe from "stripe";
import type { StripeWebhookEventCommand } from "@/lib/application/webhooks/stripe-event-command";

export function constructStripeWebhookEvent(stripe: Stripe, rawBody: string, signature: string, webhookSecret: string): StripeWebhookEventCommand {
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  return {
    id: event.id,
    type: event.type,
    data: {
      object: event.data.object
    }
  };
}
