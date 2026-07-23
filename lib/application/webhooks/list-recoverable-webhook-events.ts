export type RecoverableWebhookEvent = {
  id: string;
  stripeEventId: string;
  eventType: string;
  status: "failed_retryable" | "processing";
  attemptCount: number;
  lastAttemptedAt: string | null;
  errorSummary: string | null;
};

export type RecoverableWebhookRepository = {
  listRecoverableWebhookEvents(input: { limit: number }): Promise<RecoverableWebhookEvent[]>;
};

export async function listRecoverableWebhookEvents(
  input: { limit?: number },
  dependencies: { repository: RecoverableWebhookRepository }
) {
  return dependencies.repository.listRecoverableWebhookEvents({ limit: Math.min(Math.max(input.limit ?? 10, 1), 25) });
}
