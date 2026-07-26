import Link from "next/link";
import { CarFront, PackageCheck, Star, Wrench } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import type { AccountOrder, AccountSectionId, AccountVehicle } from "@/components/account/account-types";
import { vehicleLabel } from "@/components/account/account-types";
import { EmptyState, Panel } from "@/components/account/account-ui";

export function DashboardSection({
  orders,
  recentOrders,
  vehicles,
  defaultVehicle,
  setActiveSection,
  onFindWipers,
  busyVehicleId
}: {
  orders: AccountOrder[];
  recentOrders: AccountOrder[];
  vehicles: AccountVehicle[];
  defaultVehicle: AccountVehicle | null;
  setActiveSection: (section: AccountSectionId) => void;
  onFindWipers: (vehicle: AccountVehicle) => void;
  busyVehicleId: string;
}) {
  return (
    <section className="mt-6 grid gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric icon={<PackageCheck className="h-5 w-5" />} label="Recent Orders" value={String(orders.length)} />
        <Metric icon={<CarFront className="h-5 w-5" />} label="Saved Vehicles" value={String(vehicles.length)} />
        <Metric icon={<Star className="h-5 w-5" />} label="Default Vehicle" value={defaultVehicle ? vehicleLabel(defaultVehicle) : "Not set"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Recent Orders" icon={<PackageCheck className="h-5 w-5" />}>
          {recentOrders.length ? (
            <div className="grid gap-3">
              {recentOrders.map((order) => (
                <OrderSummary key={order.id} order={order} />
              ))}
            </div>
          ) : (
            <EmptyState text="No orders yet." />
          )}
        </Panel>

        <Panel title="Quick Actions" icon={<Wrench className="h-5 w-5" />}>
          <div className="grid gap-3">
            <button
              type="button"
              disabled={!defaultVehicle || busyVehicleId === defaultVehicle?.id}
              onClick={() => defaultVehicle && onFindWipers(defaultVehicle)}
              className="h-11 rounded bg-signal px-4 text-sm font-black text-white hover:bg-red-700 disabled:bg-zinc-300"
            >
              Find Wipers
            </button>
            <button type="button" onClick={() => setActiveSection("orders")} className="h-11 rounded border border-black/10 px-4 text-sm font-black text-ink hover:border-ink">
              Track Order
            </button>
            <button type="button" onClick={() => setActiveSection("orders")} className="h-11 rounded border border-black/10 px-4 text-sm font-black text-ink hover:border-ink">
              Reorder Previous Purchase
            </button>
            <Link href="/contact" className="inline-flex h-11 items-center justify-center rounded border border-black/10 px-4 text-sm font-black text-ink hover:border-ink">
              Contact Support
            </Link>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3 text-steel">
        {icon}
        <span className="text-xs font-black uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-4 text-2xl font-black text-ink">{value}</p>
    </div>
  );
}

function OrderSummary({ order }: { order: AccountOrder }) {
  return (
    <article className="rounded border border-black/10 bg-zinc-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Order</p>
          <p className="mt-1 font-mono text-lg font-black leading-none text-ink">{order.orderNumber}</p>
          <p className="mt-1 font-black">{order.vehicle ?? "Vehicle not attached"}</p>
          <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-signal">Status: {order.status}</p>
        </div>
        <p className="font-black">{formatMoney(order.total)}</p>
      </div>
    </article>
  );
}
