import type { StripeWebhookEventCommand } from "./stripe-event-command";
import type { StripeWebhookDependencies } from "./process-stripe-event";
import { processStripeEvent } from "./process-stripe-event";
import { WebhookApplicationError } from "./webhook.errors";

export type StripeEventRetrieval = {
  retrieveEvent(stripeEventId: string): Promise<StripeWebhookEventCommand | null>;
};

export type StripeWebhookRecoveryRepository = {
  canRetryWebhookEvent(stripeEventId: string): Promise<{ ok: boolean; reason?: string }>;
};

export async function retryStripeWebhookEvent(
  input: { stripeEventId: string },
  dependencies: StripeWebhookDependencies & {
    recovery: StripeWebhookRecoveryRepository;
    stripeEvents: StripeEventRetrieval;
  }
) {
  const retryCheck = await dependencies.recovery.canRetryWebhookEvent(input.stripeEventId);
  if (!retryCheck.ok) {
    throw new WebhookApplicationError("WEBHOOK_RECONCILIATION_ERROR", retryCheck.reason ?? "Webhook event is not retryable.", false, {
      stripeEventId: input.stripeEventId
    });
  }

  const event = await dependencies.stripeEvents.retrieveEvent(input.stripeEventId);
  if (!event) {
    throw new WebhookApplicationError("INFRASTRUCTURE_RETRYABLE", "Stripe event could not be retrieved.", true, {
      stripeEventId: input.stripeEventId
    });
  }

  return processStripeEvent(event, dependencies);
}
