import { NextResponse, type NextRequest } from "next/server";
import { FixedWindowRateLimiter, type RateLimitDecision } from "@/lib/application/fitment/request-rate-limit";

const SHOP_RATE_LIMIT = 30;
const SHOP_RATE_WINDOW_MS = 60_000;
const MAX_SHOP_URL_LENGTH = 2_048;

type SharedShopState = typeof globalThis & {
  __nexAutoShopRateLimiter?: FixedWindowRateLimiter;
};

const sharedState = globalThis as SharedShopState;
const defaultRateLimiter = sharedState.__nexAutoShopRateLimiter ?? new FixedWindowRateLimiter(SHOP_RATE_LIMIT, SHOP_RATE_WINDOW_MS);
sharedState.__nexAutoShopRateLimiter = defaultRateLimiter;

export type ShopRequestGuard = {
  decision: RateLimitDecision | null;
  response: NextResponse | null;
};

export function guardShopPageRequest(request: NextRequest, rateLimiter = defaultRateLimiter): ShopRequestGuard {
  if (request.nextUrl.pathname !== "/shop" || !["GET", "HEAD"].includes(request.method)) {
    return { decision: null, response: null };
  }

  if (request.url.length > MAX_SHOP_URL_LENGTH) {
    return {
      decision: null,
      response: new NextResponse("Request URL is too long.", {
        status: 414,
        headers: defensiveHeaders()
      })
    };
  }

  const identity = getClientIdentity(request);
  if (!identity) return { decision: null, response: null };

  const decision = rateLimiter.consume(identity);
  if (decision.allowed) return { decision, response: null };

  const headers = defensiveHeaders();
  headers.set("Retry-After", String(decision.retryAfterSeconds));
  addRateLimitHeaders(headers, decision);
  return {
    decision,
    response: new NextResponse("Too many shop requests. Please try again shortly.", {
      status: 429,
      headers
    })
  };
}

export function addShopRateLimitHeaders(headers: Headers, decision: RateLimitDecision | null) {
  if (decision) addRateLimitHeaders(headers, decision);
}

function defensiveHeaders() {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive"
  });
}

function addRateLimitHeaders(headers: Headers, decision: RateLimitDecision) {
  headers.set("RateLimit-Policy", `${decision.limit};w=${SHOP_RATE_WINDOW_MS / 1000}`);
  headers.set("RateLimit", `limit=${decision.limit}, remaining=${decision.remaining}, reset=${decision.retryAfterSeconds}`);
}

function getClientIdentity(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim();
  return candidate && /^[0-9a-f:.]{1,64}$/i.test(candidate) ? candidate : null;
}
