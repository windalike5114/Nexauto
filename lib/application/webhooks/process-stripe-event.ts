import type { FinalisedOrder } from "@/lib/application/orders/finalise-paid-order";
import type {
  StripeCheckoutSessionLike,
  StripePaymentIntentLike,
  StripeWebhookEventCommand
} from "./stripe-event-command";
import type { StripeWebhookProcessingResult } from "./stripe-event-result";
import { WebhookApplicationError } from "./webhook.errors";

const PROCESSING_LEASE_MINUTES = 10;

export type WebhookEventClaim = {
  claimStatus: "claimed" | "already_processed" | "already_processing" | "terminal" | "not_claimed";
  eventId: string;
  currentStatus: string;
};

export type StripeWebhookEventRepository = {
  claimEvent(input: {
    stripeEventId: string;
    eventType: string;
    stripeSessionId?: string | null;
    stripePaymentIntentId?: string | null;
    processingLeaseMinutes: number;
  }): Promise<WebhookEventClaim>;
  completeEvent(input: {
    stripeEventId: string;
    status: "processed" | "processed_deferred" | "failed_retryable" | "failed_terminal";
    relatedOrderId?: string | null;
    errorSummary?: string | null;
    retryable: boolean;
  }): Promise<void>;
};

export type OrderFinalisationRepository = {
  findOrderByStripeIdentifiers(input: {
    orderId?: string | null;
    stripeSessionId?: string | null;
    stripePaymentIntentId?: string | null;
  }): Promise<import("@/lib/application/orders/finalise-paid-order").FinalisableOrder | null>;
  finalisePaidOrder(input: import("@/lib/application/orders/finalise-paid-order").OrderFinalisationInput): Promise<FinalisedOrder>;
  markCheckoutExpired(input: { orderId: string; stripeSessionId: string }): Promise<void>;
  markPaymentFailed(input: { orderId?: string | null; stripeSessionId?: string | null; stripePaymentIntentId?: string | null; reason: string }): Promise<void>;
};

export type CustomerEnrichmentService = {
  enrichFromFinalisedOrder(order: FinalisedOrder): Promise<void>;
};

export type OrderEmailService = {
  sendOrderConfirmation(order: FinalisedOrder): Promise<"sent" | "skipped" | "failed_retryable">;
};

export type StripeWebhookLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

export type StripeWebhookDependencies = {
  events: StripeWebhookEventRepository;
  orders: OrderFinalisationRepository;
  customers: CustomerEnrichmentService;
  emails: OrderEmailService;
  logger?: StripeWebhookLogger;
};

export async function processStripeEvent(command: StripeWebhookEventCommand, dependencies: StripeWebhookDependencies): Promise<StripeWebhookProcessingResult> {
  const logger = dependencies.logger ?? console;
  const eventObject = command.data.object;
  const stripeSessionId = getSessionId(eventObject);
  const stripePaymentIntentId = getPaymentIntentId(eventObject);
  const claim = await dependencies.events.claimEvent({
    stripeEventId: command.id,
    eventType: command.type,
    stripeSessionId,
    stripePaymentIntentId,
    processingLeaseMinutes: PROCESSING_LEASE_MINUTES
  });

  if (claim.claimStatus === "already_processed") {
    return { received: true, status: "already_processed" };
  }

  if (claim.claimStatus === "already_processing") {
    return { received: true, status: "already_processing" };
  }

  if (claim.claimStatus !== "claimed") {
    return { received: true, status: "failed_terminal" };
  }

  try {
    const result = await processClaimedEvent(command, dependencies, logger);
    await dependencies.events.completeEvent({
      stripeEventId: command.id,
      status: result.status === "processed_deferred" ? "processed_deferred" : "processed",
      relatedOrderId: result.orderId,
      retryable: false
    });
    return result;
  } catch (error) {
    const appError = normalizeWebhookError(error);
    await dependencies.events.completeEvent({
      stripeEventId: command.id,
      status: appError.retryable ? "failed_retryable" : "failed_terminal",
      relatedOrderId: typeof appError.context.orderId === "string" ? appError.context.orderId : null,
      errorSummary: appError.message,
      retryable: appError.retryable
    });
    logger.error("stripe_webhook.failed", {
      stripeEventId: command.id,
      eventType: command.type,
      code: appError.code,
      retryable: appError.retryable,
      context: appError.context
    });
    return { received: true, status: appError.retryable ? "failed_retryable" : "failed_terminal", orderId: appError.context.orderId as string | undefined };
  }
}

async function processClaimedEvent(
  command: StripeWebhookEventCommand,
  dependencies: StripeWebhookDependencies,
  logger: StripeWebhookLogger
): Promise<StripeWebhookProcessingResult> {
  if (command.type === "checkout.session.completed" || command.type === "checkout.session.async_payment_succeeded") {
    const session = getCheckoutSession(command);

    if (session.payment_status !== "paid") {
      logger.info("stripe_webhook.checkout_not_paid", { stripeEventId: command.id, stripeSessionId: session.id, paymentStatus: session.payment_status });
      return { received: true, status: "processed_deferred" };
    }

    const order = await resolveOrder(dependencies.orders, session);
    reconcilePaidSession(order, session, command.id);
    const finalised = await dependencies.orders.finalisePaidOrder({
      order,
      session,
      invoice: parseInvoice(session.invoice),
      sourceLineKeys: buildSourceLineKeys(order.itemsSnapshot)
    });

    await runNonCritical("customer_enrichment", () => dependencies.customers.enrichFromFinalisedOrder(finalised), logger, {
      stripeEventId: command.id,
      orderId: finalised.orderId
    });
    await dependencies.emails.sendOrderConfirmation(finalised);

    return { received: true, status: "processed", orderId: finalised.orderId };
  }

  if (command.type === "checkout.session.expired") {
    const session = getCheckoutSession(command);
    const order = await dependencies.orders.findOrderByStripeIdentifiers({
      orderId: session.metadata?.order_id,
      stripeSessionId: session.id,
      stripePaymentIntentId: getPaymentIntentId(session)
    });

    if (order) {
      await dependencies.orders.markCheckoutExpired({ orderId: order.id, stripeSessionId: session.id });
    }

    return { received: true, status: "processed_deferred", orderId: order?.id ?? null };
  }

  if (command.type === "checkout.session.async_payment_failed") {
    const session = getCheckoutSession(command);
    await dependencies.orders.markPaymentFailed({
      orderId: session.metadata?.order_id,
      stripeSessionId: session.id,
      stripePaymentIntentId: getPaymentIntentId(session),
      reason: "async_payment_failed"
    });
    return { received: true, status: "processed_deferred", orderId: session.metadata?.order_id ?? null };
  }

  if (command.type === "payment_intent.payment_failed") {
    const intent = command.data.object as StripePaymentIntentLike;
    await dependencies.orders.markPaymentFailed({
      orderId: intent.metadata?.order_id,
      stripePaymentIntentId: intent.id,
      reason: intent.last_payment_error?.message ?? "payment_intent_failed"
    });
    return { received: true, status: "processed_deferred", orderId: intent.metadata?.order_id ?? null };
  }

  if (command.type === "charge.refunded" || command.type === "charge.dispute.created") {
    logger.info("stripe_webhook.deferred_event", { stripeEventId: command.id, eventType: command.type });
    return { received: true, status: "processed_deferred" };
  }

  return { received: true, status: "processed_deferred" };
}

async function resolveOrder(orders: OrderFinalisationRepository, session: StripeCheckoutSessionLike) {
  const order = await orders.findOrderByStripeIdentifiers({
    orderId: session.metadata?.order_id,
    stripeSessionId: session.id,
    stripePaymentIntentId: getPaymentIntentId(session)
  });

  if (!order) {
    throw new WebhookApplicationError("WEBHOOK_ORDER_NOT_FOUND", "Internal order could not be resolved.", false, {
      stripeSessionId: session.id,
      orderId: session.metadata?.order_id
    });
  }

  return order;
}

function reconcilePaidSession(order: Awaited<ReturnType<OrderFinalisationRepository["findOrderByStripeIdentifiers"]>> extends infer T ? NonNullable<T> : never, session: StripeCheckoutSessionLike, stripeEventId: string) {
  if (session.currency?.toLowerCase() !== order.currency.toLowerCase()) {
    throw new WebhookApplicationError("WEBHOOK_CURRENCY_MISMATCH", "Stripe currency does not match internal order currency.", false, {
      orderId: order.id,
      expectedCurrency: order.currency,
      receivedCurrency: session.currency,
      stripeEventId,
      stripeSessionId: session.id
    });
  }

  const expectedAmount = Math.round(order.subtotal * 100);
  const receivedAmount = Number(session.amount_total ?? 0);

  if (expectedAmount !== receivedAmount) {
    throw new WebhookApplicationError("WEBHOOK_AMOUNT_MISMATCH", "Stripe paid amount does not match internal order total.", false, {
      orderId: order.id,
      expectedAmount,
      receivedAmount,
      currency: order.currency,
      stripeEventId,
      stripeSessionId: session.id
    });
  }
}

function getCheckoutSession(command: StripeWebhookEventCommand) {
  const object = command.data.object as StripeCheckoutSessionLike;

  if (!object || object.object !== "checkout.session" || !object.id) {
    throw new WebhookApplicationError("WEBHOOK_RECONCILIATION_ERROR", "Stripe event does not contain a Checkout Session.", false, {
      eventType: command.type
    });
  }

  return object;
}

function getSessionId(object: unknown) {
  if (object && typeof object === "object" && "object" in object && (object as { object?: unknown }).object === "checkout.session") {
    return (object as { id?: string }).id ?? null;
  }
  return null;
}

function getPaymentIntentId(object: unknown) {
  if (!object || typeof object !== "object") return null;
  if ("payment_intent" in object) {
    const paymentIntent = (object as { payment_intent?: unknown }).payment_intent;
    if (typeof paymentIntent === "string") return paymentIntent;
    if (paymentIntent && typeof paymentIntent === "object" && "id" in paymentIntent) return String((paymentIntent as { id?: unknown }).id ?? "");
  }
  if ("object" in object && (object as { object?: unknown }).object === "payment_intent") return (object as { id?: string }).id ?? null;
  return null;
}

function parseInvoice(invoice: StripeCheckoutSessionLike["invoice"]) {
  if (!invoice) return null;
  if (typeof invoice === "string") return { id: invoice, hostedInvoiceUrl: null };
  return { id: invoice.id ?? null, hostedInvoiceUrl: invoice.hosted_invoice_url ?? null };
}

function buildSourceLineKeys(snapshot: import("@/lib/application/orders/finalise-paid-order").PendingOrderSnapshot) {
  return (snapshot.items ?? []).map((item, index) => String(item.source_line_key ?? item.attributes?.finalisation_line_key ?? item.attributes?.source_line_key ?? `line-${index}-${item.sku}`));
}

async function runNonCritical(name: string, fn: () => Promise<void>, logger: StripeWebhookLogger, context: Record<string, unknown>) {
  try {
    await fn();
  } catch (error) {
    logger.error(`stripe_webhook.non_critical_failed.${name}`, {
      ...context,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

function normalizeWebhookError(error: unknown) {
  if (error instanceof WebhookApplicationError) return error;
  return new WebhookApplicationError("INFRASTRUCTURE_RETRYABLE", error instanceof Error ? error.message : "Webhook infrastructure failed.", true);
}
