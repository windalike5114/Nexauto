export type StripeWebhookProcessingResult = {
  received: true;
  status: "processed" | "processed_deferred" | "already_processed" | "already_processing" | "failed_retryable" | "failed_terminal";
  orderId?: string | null;
};
