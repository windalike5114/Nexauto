import type { AdminOrderDetail } from "@/lib/application/admin/admin-order-detail.types";
import { formatMoney } from "@/lib/catalog";

export function AdminOrderHeader({ order }: { order: AdminOrderDetail }) {
  const blockingWarnings = order.warnings.filter((warning) => warning.blocksFulfilment).length;

  return (
    <section className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-steel">{order.identity.id}</p>
          <h1 className="mt-2 text-3xl font-black">Order {order.identity.orderNumber}</h1>
          <p className="mt-2 text-sm font-bold text-steel">
            {new Date(order.identity.createdAt).toLocaleString("en-NZ")}
            {order.identity.orderNumberSource === "legacy_fallback" ? " · legacy order number fallback" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{order.identity.status}</Badge>
          <Badge>{formatMoney(order.pricing.grandTotal)}</Badge>
          <Badge>{order.fulfilments.length ? `${order.fulfilments.length} fulfilment row${order.fulfilments.length === 1 ? "" : "s"}` : "No fulfilment"}</Badge>
          {blockingWarnings ? <Badge tone="critical">{blockingWarnings} blocking</Badge> : null}
        </div>
      </div>
    </section>
  );
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "critical" }) {
  const classes = tone === "critical" ? "bg-red-50 text-red-700" : "bg-zinc-100 text-steel";
  return <span className={`rounded px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${classes}`}>{children}</span>;
}
