import assert from "node:assert/strict";
import test from "node:test";
import { parseAdminOrderListQuery, normalizeAdminOrderSearch } from "../lib/application/admin/admin-order-list-query.schema";
import { adminPendingStaleAfterHours, type AdminOrderListRepository, type AdminOrderRow } from "../lib/application/admin/admin-order-list.types";
import {
  aggregateFulfilmentStatus,
  getAttentionReasons,
  getVehicleSummary,
  listAdminOrders,
  mapOrderListItem,
  selectLatestEmail
} from "../lib/application/admin/list-admin-orders";
import { buildOrderSearchOrFilter, buildOrderSearchOrFilterWithOptions } from "../lib/infrastructure/supabase/admin-order.repository";
import { buildPageHref } from "../components/admin/order-list/admin-order-pagination";
import type { AdminAccessContext } from "../lib/domain/admin/admin-access.types";
import { readFileSync } from "node:fs";

const admin: AdminAccessContext = { authUserId: "admin-1", email: "owner@nexautoparts.co.nz", role: "admin" };

test("admin order query defaults and maximum page size are enforced", () => {
  const defaults = parseAdminOrderListQuery({});
  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, 25);
  assert.equal(defaults.sort, "order_desc");
  assert.equal(parseAdminOrderListQuery({ page: "2", pageSize: "100", sort: "created_asc" }).pageSize, 100);
  assert.equal(parseAdminOrderListQuery({ pageSize: "1000" }).pageSize, 25);
});

test("empty normalized search behaves as no search filter", () => {
  assert.equal(normalizeAdminOrderSearch("  %_,()'\\  "), undefined);
});

test("search special characters are normalized before PostgREST filter construction", () => {
  const input = "%_comma,(test).+ buyer+test@example.co.nz O'Brien \\";
  const search = normalizeAdminOrderSearch(input);
  assert.equal(search, "comma test .+ buyer+test@example.co.nz O Brien");
  const filter = buildOrderSearchOrFilter(search!);
  assert.doesNotMatch(filter, /[()'\\]/);
  assert.match(filter, /buyer\+test@example\.co\.nz/);
  assert.equal(filter.split(",").length, 3);
});

test("legacy order search filter can omit order_number when a database has not applied that migration", () => {
  const filter = buildOrderSearchOrFilterWithOptions("NEX00001 buyer@example.co.nz", { includeOrderNumber: false });

  assert.doesNotMatch(filter, /order_number/);
  assert.match(filter, /email\.ilike/);
  assert.match(filter, /customer_name\.ilike/);
});

test("default order list uses database pagination and fixed summary query count", async () => {
  const repo = new FakeAdminOrderRepository();
  const result = await listAdminOrders(parseAdminOrderListQuery({ page: "1" }), admin, repo);

  assert.equal(result.orders.length, 2);
  assert.equal(result.pagination.totalItems, 2);
  assert.deepEqual(repo.calls, ["listOrders", "listPageSummaries:2"]);
});

test("needs-attention filter uses fixed candidate lookup, not per-order queries", async () => {
  const repo = new FakeAdminOrderRepository();
  const result = await listAdminOrders(parseAdminOrderListQuery({ needsAttention: "true" }), admin, repo);

  assert.equal(result.orders.length, 1);
  assert.deepEqual(repo.calls, ["listAttentionOrderIds", "listOrders", "listPageSummaries:1"]);
});

test("out-of-range pages return an empty current page with total metadata", async () => {
  const repo = new EmptyPageAdminOrderRepository();
  const result = await listAdminOrders(parseAdminOrderListQuery({ page: "99", pageSize: "25" }), admin, repo);

  assert.equal(result.orders.length, 0);
  assert.equal(result.pagination.page, 99);
  assert.equal(result.pagination.totalItems, 2);
  assert.equal(result.pagination.totalPages, 1);
  assert.deepEqual(repo.calls, ["listOrders", "listPageSummaries:0"]);
});

test("guest versus account, vehicle summary, fulfilment and email labels map correctly", () => {
  const item = mapOrderListItem(
    orderRow({ id: "order-1", customerProfileId: "profile-1", status: "paid" }),
    {
      items: [{ orderId: "order-1", sku: "WPFP2418", wiperSetId: "set-1" }],
      vehicles: [{ orderId: "order-1", year: 2020, make: "Toyota", model: "Hilux" }],
      fulfilments: [{ orderId: "order-1", status: "selected", driverLengthIn: 24, passengerLengthIn: 18, rearLengthIn: null, driverConnector: "A", passengerConnector: "B", rearConnector: null }],
      emails: [{ orderId: "order-1", status: "delivered", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T01:00:00.000Z" }]
    },
    "2026-07-01T00:00:00.000Z"
  );

  assert.equal(item.accountType, "account");
  assert.equal(item.vehicleSummary, "2020 Toyota Hilux");
  assert.equal(item.fulfilmentStatusLabel, "Picking");
  assert.equal(item.emailStatusLabel, "Delivered");
  assert.equal(item.paymentStatusLabel, "Paid");
});

test("multiple vehicle summary is deterministic", () => {
  assert.equal(
    getVehicleSummary([
      { orderId: "order-1", year: 2020, make: "Toyota", model: "Hilux" },
      { orderId: "order-1", year: 2018, make: "Mazda", model: "3" }
    ]),
    "2020 Toyota Hilux +1 more"
  );
});

test("mixed fulfilment status aggregate uses urgency priority", () => {
  assert.equal(
    aggregateFulfilmentStatus([
      { orderId: "order-1", status: "fulfilled", driverLengthIn: 24, passengerLengthIn: 18, rearLengthIn: null, driverConnector: "A", passengerConnector: "B", rearConnector: null },
      { orderId: "order-1", status: "pending", driverLengthIn: 20, passengerLengthIn: 18, rearLengthIn: null, driverConnector: null, passengerConnector: null, rearConnector: null }
    ]),
    "pending"
  );
  assert.equal(aggregateFulfilmentStatus([]), "unfulfilled");
});

test("missing fulfilment applies only to paid orders with wiper set items", () => {
  const staleBefore = "2026-07-25T00:00:00.000Z";
  assert.deepEqual(getAttentionReasons(orderRow({ status: "paid" }), [{ orderId: "order-1", sku: "WPFP2418", wiperSetId: "set-1" }], [], undefined, staleBefore), [
    "missing_fulfilment"
  ]);
  assert.deepEqual(getAttentionReasons(orderRow({ status: "paid" }), [{ orderId: "order-1", sku: "BULB-H11", wiperSetId: null }], [], undefined, staleBefore), []);
});

test("missing adapter excludes non-required and rear-only connector fields", () => {
  const staleBefore = "2026-07-25T00:00:00.000Z";
  const reasons = getAttentionReasons(
    orderRow({ status: "paid" }),
    [{ orderId: "order-1", sku: "WPFP2418", wiperSetId: "set-1" }],
    [{ orderId: "order-1", status: "pending", driverLengthIn: 24, passengerLengthIn: 18, rearLengthIn: 14, driverConnector: null, passengerConnector: "B", rearConnector: null }],
    undefined,
    staleBefore
  );
  assert.deepEqual(reasons, ["missing_adapter"]);

  assert.deepEqual(
    getAttentionReasons(
      orderRow({ status: "paid" }),
      [{ orderId: "order-1", sku: "REAR14", wiperSetId: null }],
      [{ orderId: "order-1", status: "pending", driverLengthIn: null, passengerLengthIn: null, rearLengthIn: 14, driverConnector: null, passengerConnector: null, rearConnector: null }],
      undefined,
      staleBefore
    ),
    []
  );
});

test("latest stable order confirmation email event wins", () => {
  const latest = selectLatestEmail([
    { status: "sent", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" },
    { status: "delivered", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:05:00.000Z" }
  ]);
  assert.equal(latest?.status, "delivered");
});

test("stale pending threshold is explicit and boundary-safe", () => {
  const now = Date.UTC(2026, 6, 26, 0, 0, 0);
  const staleBefore = new Date(now - adminPendingStaleAfterHours * 60 * 60 * 1000).toISOString();
  assert.deepEqual(getAttentionReasons(orderRow({ status: "pending", createdAt: "2026-07-24T23:59:59.000Z" }), [], [], undefined, staleBefore), ["stale_pending"]);
  assert.deepEqual(getAttentionReasons(orderRow({ status: "pending", createdAt: staleBefore }), [], [], undefined, staleBefore), []);
});

test("pagination URLs preserve active filters", () => {
  const href = buildPageHref(
    parseAdminOrderListQuery({
      search: "NEX",
      orderStatus: "paid",
      fulfilmentStatus: "pending",
      needsAttention: "true",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-26",
      pageSize: "50",
      sort: "created_asc"
    }),
    3
  );

  assert.match(href, /tab=orders/);
  assert.match(href, /page=3/);
  assert.match(href, /search=NEX/);
  assert.match(href, /orderStatus=paid/);
  assert.match(href, /fulfilmentStatus=pending/);
  assert.match(href, /needsAttention=true/);
  assert.match(href, /pageSize=50/);
  assert.match(href, /sort=created_asc/);
});

test("filter form resets page to 1", () => {
  const source = readFileSync("components/admin/order-list/admin-order-filters.tsx", "utf8");
  assert.match(source, /name="page" value="1"/);
});

function orderRow(overrides: Partial<AdminOrderRow> = {}): AdminOrderRow {
  return {
    id: "order-1",
    orderNumber: "NEX00001",
    email: "buyer@example.co.nz",
    customerName: "Buyer",
    customerProfileId: null,
    subtotal: 59.99,
    currency: "nzd",
    status: "paid",
    createdAt: "2026-07-26T00:00:00.000Z",
    ...overrides
  };
}

class FakeAdminOrderRepository implements AdminOrderListRepository {
  calls: string[] = [];

  async listOrders(input: Parameters<AdminOrderListRepository["listOrders"]>[0]) {
    this.calls.push("listOrders");
    const rows = [
      orderRow({ id: "order-1", orderNumber: "NEX00001", customerProfileId: "profile-1" }),
      orderRow({ id: "order-2", orderNumber: "NEX00002", email: "guest@example.co.nz", customerName: null })
    ].filter((row) => !input.attentionOrderIds || input.attentionOrderIds.includes(row.id));
    return { rows, totalItems: rows.length };
  }

  async listAttentionOrderIds() {
    this.calls.push("listAttentionOrderIds");
    return new Set(["order-1"]);
  }

  async listPageSummaries(orderIds: string[]) {
    this.calls.push(`listPageSummaries:${orderIds.length}`);
    return {
      items: orderIds.map((orderId) => ({ orderId, sku: "WPFP2418", wiperSetId: "set-1" })),
      vehicles: orderIds.map((orderId) => ({ orderId, year: 2020, make: "Toyota", model: "Hilux" })),
      fulfilments: orderIds.map((orderId) => ({
        orderId,
        status: "selected",
        driverLengthIn: 24,
        passengerLengthIn: 18,
        rearLengthIn: null,
        driverConnector: "A",
        passengerConnector: "B",
        rearConnector: null
      })),
      emails: orderIds.map((orderId) => ({
        orderId,
        status: "sent",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      }))
    };
  }
}

class EmptyPageAdminOrderRepository extends FakeAdminOrderRepository {
  override async listOrders() {
    this.calls.push("listOrders");
    return { rows: [], totalItems: 2 };
  }
}
