import { z } from "zod";
import {
  adminEmailStatuses,
  adminFulfilmentStatuses,
  adminOrderSorts,
  adminOrderStatuses,
  type AdminOrderListQuery
} from "@/lib/application/admin/admin-order-list.types";

const maxSearchLength = 80;
const maxPageSize = 100;

export function normalizeAdminOrderSearch(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .slice(0, maxSearchLength)
    .replace(/[%_,()'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

export const AdminOrderListQuerySchema = z
  .object({
    search: z.preprocess(normalizeAdminOrderSearch, z.string().max(maxSearchLength).optional()),
    orderStatus: z.enum(adminOrderStatuses).optional(),
    fulfilmentStatus: z.enum(adminFulfilmentStatuses).optional(),
    emailStatus: z.enum(adminEmailStatuses).optional(),
    needsAttention: z.preprocess(parseBooleanParam, z.boolean().optional()),
    dateFrom: z.preprocess(parseDateParam, z.string().datetime().optional()),
    dateTo: z.preprocess(parseDateParam, z.string().datetime().optional()),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(maxPageSize).default(25),
    sort: z.enum(adminOrderSorts).default("order_desc")
  })
  .strict();

export function parseAdminOrderListQuery(input: Record<string, unknown>): AdminOrderListQuery {
  const candidate = pickOrderListQueryInput(input);
  const parsed = AdminOrderListQuerySchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  return AdminOrderListQuerySchema.parse({
    ...candidate,
    page: 1,
    pageSize: 25,
    sort: "order_desc",
    orderStatus: undefined,
    fulfilmentStatus: undefined,
    emailStatus: undefined,
    needsAttention: undefined,
    dateFrom: undefined,
    dateTo: undefined
  });
}

function pickOrderListQueryInput(input: Record<string, unknown>) {
  return {
    search: input.search,
    orderStatus: input.orderStatus,
    fulfilmentStatus: input.fulfilmentStatus,
    emailStatus: input.emailStatus,
    needsAttention: input.needsAttention,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort
  };
}

export function getAdminOrderSearchSemantics() {
  return {
    orderNumber: "case-insensitive partial match",
    customerEmail: "case-insensitive partial match",
    customerName: "case-insensitive partial match",
    normalization: "trim, cap at 80 characters, remove PostgREST filter delimiters and SQL wildcard characters",
    emptySearch: "no search filter"
  };
}

function parseBooleanParam(value: unknown) {
  if (value === true || value === "true" || value === "1" || value === "on") return true;
  if (value === false || value === "false" || value === "0" || value === "off") return false;
  return undefined;
}

function parseDateParam(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
