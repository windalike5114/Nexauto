import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { guardShopPageRequest } from "../lib/application/catalog/shop-request-guard";
import { FixedWindowRateLimiter } from "../lib/application/fitment/request-rate-limit";
import { getProductCategoryDefinition, getProductCategoryLabel, productCategoryDefinitions } from "../lib/product-categories";
import {
  buildShopPageHref,
  getShopPaginationPages,
  paginateShopItems,
  parseShopPage,
  SHOP_PAGE_SIZE
} from "../lib/shop-pagination";

test("shop pagination defaults to page one and rejects abusive page values", () => {
  assert.equal(SHOP_PAGE_SIZE, 12);
  assert.equal(parseShopPage(undefined), 1);
  assert.equal(parseShopPage("2"), 2);
  assert.equal(parseShopPage("0"), null);
  assert.equal(parseShopPage("-1"), null);
  assert.equal(parseShopPage("1.5"), null);
  assert.equal(parseShopPage("1001"), null);
});

test("shop pagination returns twelve products and stable navigation URLs", () => {
  const result = paginateShopItems(Array.from({ length: 25 }, (_, index) => index + 1), 2);

  assert.deepEqual(result.items, [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.equal(result.totalPages, 3);
  assert.equal(buildShopPageHref({ category: "wipers", q: "front pair" }, 2), "/shop?category=wipers&q=front+pair&page=2");
  assert.equal(buildShopPageHref({ category: "all" }, 1), "/shop");
  assert.deepEqual(getShopPaginationPages(5, 10), [1, 4, 5, 6, 10]);
});

test("catalog category mapping exposes current product families including brake pads", () => {
  assert.deepEqual(productCategoryDefinitions.map((category) => category.key), [
    "wipers",
    "filters",
    "brakes",
    "bulbs",
    "batteries",
    "suspension"
  ]);
  assert.equal(getProductCategoryDefinition("filters")?.databaseSlug, "filter");
  assert.equal(getProductCategoryDefinition("batteries")?.databaseSlug, "battery");
  assert.equal(getProductCategoryDefinition("brakes")?.databaseSlug, "brake-pad");
  assert.equal(getProductCategoryLabel("brake-pad"), "Brake Pads");
});

test("shop request guard rate limits repeated listing requests by client IP", () => {
  const limiter = new FixedWindowRateLimiter(2, 60_000);
  const request = new NextRequest("https://example.test/shop?page=2", {
    headers: { "x-forwarded-for": "192.0.2.20" }
  });

  assert.equal(guardShopPageRequest(request, limiter).response, null);
  assert.equal(guardShopPageRequest(request, limiter).response, null);
  const blocked = guardShopPageRequest(request, limiter).response;
  assert.equal(blocked?.status, 429);
  assert.equal(blocked?.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  assert.ok(Number(blocked?.headers.get("Retry-After")) >= 1);
});

test("robots policy keeps search indexing available while declining known data-harvesting crawlers", () => {
  const source = readFileSync("app/robots.ts", "utf8");

  assert.match(source, /Google-Extended/);
  assert.match(source, /GPTBot/);
  assert.match(source, /\/shop\?\*q=\*/);
  assert.doesNotMatch(source, /userAgent:\s*"Googlebot"/);
});
