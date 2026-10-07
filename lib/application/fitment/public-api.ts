import { NextResponse } from "next/server";
import { FixedWindowRateLimiter, type RateLimitDecision } from "@/lib/application/fitment/request-rate-limit";

const FITMENT_RATE_LIMIT = 90;
const FITMENT_RATE_WINDOW_MS = 60_000;
const MAX_REQUEST_URL_LENGTH = 2_048;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SharedFitmentState = typeof globalThis & {
  __nexAutoFitmentRateLimiter?: FixedWindowRateLimiter;
};

const sharedState = globalThis as SharedFitmentState;
const rateLimiter = sharedState.__nexAutoFitmentRateLimiter ?? new FixedWindowRateLimiter(FITMENT_RATE_LIMIT, FITMENT_RATE_WINDOW_MS);
sharedState.__nexAutoFitmentRateLimiter = rateLimiter;

export type FitmentApiGuard = {
  headers: Headers;
  response: NextResponse | null;
};

export function guardFitmentApiRequest(request: Request): FitmentApiGuard {
  const baseHeaders = createBaseHeaders();
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite === "cross-site") {
    return {
      headers: baseHeaders,
      response: NextResponse.json({ error: "Cross-site fitment requests are not allowed." }, { status: 403, headers: baseHeaders })
    };
  }

  if (request.url.length > MAX_REQUEST_URL_LENGTH) {
    return {
      headers: baseHeaders,
      response: NextResponse.json({ error: "Fitment request URL is too long." }, { status: 414, headers: baseHeaders })
    };
  }

  const decision = rateLimiter.consume(getClientIdentity(request));
  addRateLimitHeaders(baseHeaders, decision);

  if (!decision.allowed) {
    baseHeaders.set("Retry-After", String(decision.retryAfterSeconds));
    return {
      headers: baseHeaders,
      response: NextResponse.json({ error: "Too many fitment requests. Please try again shortly." }, { status: 429, headers: baseHeaders })
    };
  }

  return { headers: baseHeaders, response: null };
}

export function fitmentJson(body: unknown, guard: FitmentApiGuard, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  guard.headers.forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { ...init, headers });
}

export function parseFitmentId(value: string | null) {
  if (!value || value.length > 64 || !UUID_PATTERN.test(value)) return null;
  return value;
}

export function parseVehicleYear(value: string | null, currentYear = new Date().getFullYear()) {
  if (!value || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1886 && year <= currentYear + 2 ? year : null;
}

export function hasOnlySearchParams(searchParams: URLSearchParams, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return [...searchParams.keys()].every((key) => allowedSet.has(key));
}

function createBaseHeaders() {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive"
  });
}

function addRateLimitHeaders(headers: Headers, decision: RateLimitDecision) {
  headers.set("RateLimit-Policy", `${decision.limit};w=${FITMENT_RATE_WINDOW_MS / 1000}`);
  headers.set("RateLimit", `limit=${decision.limit}, remaining=${decision.remaining}, reset=${decision.retryAfterSeconds}`);
}

function getClientIdentity(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return /^[0-9a-f:.]{1,64}$/i.test(candidate) ? candidate : "unknown";
}
