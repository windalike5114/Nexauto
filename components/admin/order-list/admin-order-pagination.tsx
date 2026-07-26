import Link from "next/link";
import type { AdminOrderListPagination, AdminOrderListQuery } from "@/lib/application/admin/admin-order-list.types";

export function AdminOrderPagination({ pagination, query }: { pagination: AdminOrderListPagination; query: AdminOrderListQuery }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-4 text-sm font-bold text-steel sm:flex-row sm:items-center sm:justify-between">
      <p>
        Page {pagination.page} of {pagination.totalPages} · {pagination.totalItems} orders
      </p>
      <div className="flex gap-2">
        <PageLink disabled={!pagination.hasPreviousPage} href={buildPageHref(query, pagination.page - 1)}>
          Previous
        </PageLink>
        <PageLink disabled={!pagination.hasNextPage} href={buildPageHref(query, pagination.page + 1)}>
          Next
        </PageLink>
      </div>
    </div>
  );
}

export function buildPageHref(query: AdminOrderListQuery, page: number) {
  const params = new URLSearchParams({ tab: "orders", page: String(Math.max(1, page)) });
  if (query.search) params.set("search", query.search);
  if (query.orderStatus) params.set("orderStatus", query.orderStatus);
  if (query.fulfilmentStatus) params.set("fulfilmentStatus", query.fulfilmentStatus);
  if (query.emailStatus) params.set("emailStatus", query.emailStatus);
  if (query.needsAttention) params.set("needsAttention", "true");
  if (query.dateFrom) params.set("dateFrom", query.dateFrom.slice(0, 10));
  if (query.dateTo) params.set("dateTo", query.dateTo.slice(0, 10));
  if (query.pageSize !== 25) params.set("pageSize", String(query.pageSize));
  if (query.sort !== "order_desc") params.set("sort", query.sort);
  return `/admin?${params.toString()}`;
}

function PageLink({ disabled, href, children }: { disabled: boolean; href: string; children: React.ReactNode }) {
  if (disabled) {
    return <span className="inline-flex h-10 items-center rounded border border-black/10 bg-zinc-50 px-4 text-steel/60">{children}</span>;
  }

  return (
    <Link href={href as never} className="inline-flex h-10 items-center rounded border border-black/10 bg-white px-4 font-black text-ink hover:border-ink">
      {children}
    </Link>
  );
}
