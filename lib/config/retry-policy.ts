export const retryPolicy = {
  maxApplicationAttempts: 5,
  webhookDelayMinutes: [5, 15, 60, 360, 1440],
  emailDelayMinutes: [5, 30, 120, 480, 1440],
  processingLeaseMinutes: 10,
  batchLimit: 10
} as const;

export function getNextRetryAt(kind: "webhook" | "email", attemptCount: number, now = new Date()) {
  const delays = kind === "webhook" ? retryPolicy.webhookDelayMinutes : retryPolicy.emailDelayMinutes;
  const delay = delays[Math.min(Math.max(0, attemptCount), delays.length - 1)];
  return new Date(now.getTime() + delay * 60_000).toISOString();
}
