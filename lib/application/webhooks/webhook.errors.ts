export type WebhookErrorCode =
  | "WEBHOOK_EVENT_CLAIM_FAILED"
  | "WEBHOOK_ORDER_NOT_FOUND"
  | "WEBHOOK_RECONCILIATION_ERROR"
  | "WEBHOOK_AMOUNT_MISMATCH"
  | "WEBHOOK_CURRENCY_MISMATCH"
  | "ORDER_FINALISATION_ERROR"
  | "INFRASTRUCTURE_RETRYABLE";

export class WebhookApplicationError extends Error {
  constructor(
    public readonly code: WebhookErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "WebhookApplicationError";
  }
}

export function isWebhookApplicationError(error: unknown): error is WebhookApplicationError {
  return error instanceof WebhookApplicationError;
}
