import Link from "next/link";
import { formatMoney } from "@/lib/catalog";
import type { AdminOrderListResult } from "@/lib/application/admin/admin-order-list.types";
import { AdminAttentionBadge } from "@/components/admin/order-list/admin-attention-badge";
import { AdminOrderEmpty } from "@/components/admin/order-list/admin-order-empty";
import { AdminOrderFilters } from "@/components/admin/order-list/admin-order-filters";
import { AdminOrderPagination } from "@/components/admin/order-list/admin-order-pagination";
import { AdminOrderStatusBadge } from "@/components/admin/order-list/admin-order-status-badge";

export function AdminOrderList({ result }: { result: AdminOrderListResult }) {
  return (
    <section className="mt-8 grid gap-4">
      <div>
        <h2 className="text-xl font-black">Orders</h2>
        <p className="mt-2 text-sm font-bold leading-6 text-steel">
          Search by order number, customer email, or customer name. Results are loaded with database pagination.
        </p>
      </div>

      <AdminOrderFilters query={result.activeFilters} />

      {result.orders.length ? (
        <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
          <div className="hidden grid-cols-[180px_150px_1.2fr_120px_140px_140px_1fr_110px] gap-3 border-b border-black/10 bg-zinc-50 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-steel xl:grid">
            <span>Order</span>
            <span>Date</span>
            <span>Customer</span>
            <span>Total</span>
            <span>Payment</span>
            <span>Fulfilment</span>
            <span>Vehicle / Attention</span>
            <span></span>
          </div>
          <div className="divide-y divide-black/10">
            {result.orders.map((order) => (
              <article key={order.id} className="grid gap-3 px-4 py-4 text-sm xl:grid-cols-[180px_150px_1.2fr_120px_140px_140px_1fr_110px] xl:items-center">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Order</p>
                  <p className="mt-1 font-mono text-xl font-black leading-none text-ink">{order.orderNumber}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-steel">{order.accountType}</p>
                </div>
                <p className="font-bold text-steel">{new Date(order.createdAt).toLocaleString("en-NZ")}</p>
                <div>
                  <p className="font-black">{order.customerName ?? "Guest customer"}</p>
                  <p className="mt-1 break-all text-xs font-bold text-steel">{order.customerEmail ?? "No email"}</p>
                </div>
                <p className="font-black">{formatMoney(order.totalMinor / 100)}</p>
                <AdminOrderStatusBadge label={order.paymentStatusLabel} tone={order.orderStatus === "paid" ? "good" : order.orderStatus === "failed" ? "danger" : "neutral"} />
                <AdminOrderStatusBadge label={order.fulfilmentStatusLabel} tone={order.fulfilmentStatus === "issue" ? "danger" : order.fulfilmentStatus === "fulfilled" ? "good" : "warning"} />
                <div>
                  <p className="font-bold text-ink">{order.vehicleSummary}</p>
                  <div className="mt-2">
                    <AdminAttentionBadge reasons={order.attentionReasons} />
                  </div>
                  <p className="mt-2 text-xs font-bold text-steel">Email: {order.emailStatusLabel}</p>
                </div>
                <Link href={order.detailUrl as never} className="inline-flex h-10 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white hover:bg-black">
                  Details
                </Link>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <AdminOrderEmpty />
      )}

      <AdminOrderPagination pagination={result.pagination} query={result.activeFilters} />
    </section>
  );
}
