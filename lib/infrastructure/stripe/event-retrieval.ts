import Stripe from "stripe";
import type { StripeWebhookEventCommand } from "@/lib/application/webhooks/stripe-event-command";

export function createStripeEventRetrieval(stripe: Stripe) {
  return {
    async retrieveEvent(stripeEventId: string): Promise<StripeWebhookEventCommand | null> {
      const event = await stripe.events.retrieve(stripeEventId);
      return {
        id: event.id,
        type: event.type,
        data: {
          object: event.data.object
        }
      };
    }
  };
}
