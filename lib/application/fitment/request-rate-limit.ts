export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries = 10_000
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer.");
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error("Rate limit window must be positive.");
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("Rate limit entry cap must be positive.");
  }

  consume(key: string, now = Date.now()): RateLimitDecision {
    const current = this.entries.get(key);

    if (!current || current.resetAt <= now) {
      this.ensureCapacity(now);
      const resetAt = now + this.windowMs;
      this.entries.set(key, { count: 1, resetAt });
      return this.decision(true, 1, resetAt, now);
    }

    current.count += 1;
    this.entries.set(key, current);
    return this.decision(current.count <= this.limit, current.count, current.resetAt, now);
  }

  private decision(allowed: boolean, count: number, resetAt: number, now: number): RateLimitDecision {
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - count),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000))
    };
  }

  private ensureCapacity(now: number) {
    if (this.entries.size < this.maxEntries) return;

    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }

    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}
