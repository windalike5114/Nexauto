import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  guardFitmentApiRequest,
  hasOnlySearchParams,
  parseFitmentId,
  parseVehicleYear
} from "../lib/application/fitment/public-api";
import { FixedWindowRateLimiter } from "../lib/application/fitment/request-rate-limit";
import {
  formatWiperFitmentVariantLabel,
  toPublicWiperFitmentResult,
  type WiperFitmentResult
} from "../lib/queries/wiper-fitment";

const UUID = "11111111-2222-4333-8444-555555555555";

test("fitment rate limiter blocks excess requests and resets deterministically", () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000, 10);

  assert.deepEqual(limiter.consume("client", 5_000), {
    allowed: true,
    limit: 2,
    remaining: 1,
    resetAt: 6_000,
    retryAfterSeconds: 1
  });
  assert.equal(limiter.consume("client", 5_100).allowed, true);
  const blocked = limiter.consume("client", 5_200);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(limiter.consume("client", 6_000).allowed, true);
});

test("fitment request validation accepts only UUIDs, bounded years, and known parameters", () => {
  assert.equal(parseFitmentId(UUID), UUID);
  assert.equal(parseFitmentId("legacy:" + UUID), null);
  assert.equal(parseFitmentId("not-an-id"), null);
  assert.equal(parseVehicleYear("2024", 2026), 2024);
  assert.equal(parseVehicleYear("2200", 2026), null);
  assert.equal(parseVehicleYear("24", 2026), null);
  assert.equal(hasOnlySearchParams(new URLSearchParams({ makeId: UUID }), ["makeId"]), true);
  assert.equal(hasOnlySearchParams(new URLSearchParams({ makeId: UUID, export: "all" }), ["makeId"]), false);
});

test("fitment API guard rejects explicit cross-site browser requests and sets defensive headers", () => {
  const crossSite = guardFitmentApiRequest(new Request("https://example.test/api/fitment/wipers/makes", {
    headers: { "sec-fetch-site": "cross-site", "x-forwarded-for": "192.0.2.10" }
  }));
  assert.equal(crossSite.response?.status, 403);
  assert.equal(crossSite.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(crossSite.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.equal(crossSite.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");

  const sameOrigin = guardFitmentApiRequest(new Request("https://example.test/api/fitment/wipers/makes", {
    headers: { "sec-fetch-site": "same-origin", "x-forwarded-for": "192.0.2.11" }
  }));
  assert.equal(sameOrigin.response, null);
  assert.match(sameOrigin.headers.get("RateLimit") ?? "", /limit=90/);
});

test("public fitment response omits raw catalogue and presentation fields", () => {
  const result = toPublicWiperFitmentResult(legacyFitment());

  assert.deepEqual(Object.keys(result).sort(), [
    "applicationId",
    "applicationKind",
    "driverLengthIn",
    "passengerLengthIn",
    "rearLengthIn",
    "yearRange"
  ]);
  assert.equal(result.yearRange, "2011–2025");
  assert.equal("startRaw" in result, false);
  assert.equal("generationName" in result, false);
});

test("legacy variant labels use numeric years and deduplicate repeated raw names", () => {
  assert.equal(formatWiperFitmentVariantLabel(legacyFitment()), "NHP10 · 2011–2025");
});

test("canonical variant labels show body, chassis or generation with years without duplicates", () => {
  assert.equal(formatWiperFitmentVariantLabel(canonicalFitment()), "E210 · Hatchback · 2019–ON");
});

test("all public fitment routes use the shared guard and hide database error messages", () => {
  for (const route of ["makes", "models", "years", "variants", "results"]) {
    const source = readFileSync(`app/api/fitment/wipers/${route}/route.ts`, "utf8");
    assert.match(source, /guardFitmentApiRequest\(request\)/);
    assert.doesNotMatch(source, /error instanceof Error \? error\.message/);
  }

  const resultsRoute = readFileSync("app/api/fitment/wipers/results/route.ts", "utf8");
  assert.match(resultsRoute, /toPublicWiperFitmentResult\(fitment\)/);
  assert.doesNotMatch(resultsRoute, /\.\.\.fitment,/);
});

function legacyFitment(): WiperFitmentResult {
  return {
    applicationId: UUID,
    applicationKind: "legacy",
    make: "Toyota",
    model: "Aqua",
    generationName: null,
    variantName: null,
    bodyStyle: null,
    startRaw: "2011 - 2025 (NHP10)",
    endRaw: "2011 - 2025 (NHP10)",
    startYear: 2011,
    endYear: 2025,
    driverLengthIn: 26,
    passengerLengthIn: 14,
    rearLengthIn: 12
  };
}

function canonicalFitment(): WiperFitmentResult {
  return {
    applicationId: UUID,
    applicationKind: "canonical",
    make: "Toyota",
    model: "Corolla",
    generationName: "E210",
    variantName: "Hatchback",
    bodyStyle: "hatchback",
    startRaw: null,
    endRaw: null,
    startYear: 2019,
    endYear: null,
    driverLengthIn: 26,
    passengerLengthIn: 16,
    rearLengthIn: 12
  };
}
