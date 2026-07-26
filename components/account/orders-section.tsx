import { Download, PackageCheck, RotateCcw, Truck } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import type { AccountOrder } from "@/components/account/account-types";
import { EmptyState, InfoTile, Panel } from "@/components/account/account-ui";

export function OrdersSection({ orders }: { orders: AccountOrder[] }) {
  return (
    <Panel title="Orders" icon={<PackageCheck className="h-5 w-5" />} className="mt-6">
      {orders.length ? (
        <div className="grid gap-4">
          {orders.map((order) => (
            <article key={order.id} className="rounded-lg border border-black/10 bg-zinc-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-mono text-xs font-black text-steel">Order Number {order.orderNumber}</p>
                  <h3 className="mt-1 text-xl font-black">{formatMoney(order.total)}</h3>
                  <p className="mt-1 text-sm font-bold text-steel">Order Date {new Date(order.orderDate).toLocaleDateString("en-NZ")}</p>
                </div>
                <span className="inline-flex h-8 items-center rounded bg-white px-3 text-xs font-black uppercase tracking-[0.12em] text-signal">{order.status}</span>
              </div>
              <div className="mt-4 rounded border border-red-100 bg-white p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Order status</p>
                <p className="mt-1 text-2xl font-black text-ink">{order.status}</p>
                <p className="mt-2 text-sm font-bold leading-6 text-steel">{order.statusDescription}</p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <InfoTile label="Vehicle" value={order.vehicle ?? "Not attached"} />
                <InfoTile label="Payment" value={formatOrderStatus(order.paymentStatus)} />
                <InfoTile label="Fulfilment" value={formatOrderStatus(order.fulfillmentStatus ?? "pending")} />
                <InfoTile label="Total" value={formatMoney(order.total)} />
              </div>
              <div className="mt-3">
                <InfoTile label="Products" value={order.products.join(", ") || "No products"} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <OrderButton icon={<PackageCheck className="h-4 w-4" />} label="View Details" />
                <OrderButton icon={<Truck className="h-4 w-4" />} label="Track Order" />
                <OrderButton icon={<Download className="h-4 w-4" />} label="Download Invoice" />
                <OrderButton icon={<RotateCcw className="h-4 w-4" />} label="Reorder" />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No orders yet." />
      )}
    </Panel>
  );
}

function OrderButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button type="button" disabled className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-black text-steel">
      {icon}
      {label}
    </button>
  );
}

function formatOrderStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
