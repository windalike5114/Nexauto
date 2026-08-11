import type { AdminOrderDetailVehicleSnapshot } from "@/lib/application/admin/admin-order-detail.types";

export function AdminOrderVehiclesCard({ vehicles }: { vehicles: AdminOrderDetailVehicleSnapshot[] }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Vehicle snapshots</h2>
      <div className="mt-4 grid gap-3">
        {vehicles.map((vehicle) => (
          <article key={vehicle.id} className="rounded border border-black/10 bg-zinc-50 p-4">
            <h3 className="font-black">{vehicle.label}</h3>
            {[vehicle.startRaw, vehicle.endRaw].filter(Boolean).length ? (
              <p className="mt-2 text-sm font-bold text-steel">
                Fitment range: {[vehicle.startRaw, vehicle.endRaw].filter(Boolean).join(" - ")}
              </p>
            ) : null}
          </article>
        ))}
        {vehicles.length === 0 ? <p className="text-sm font-bold text-steel">No vehicle snapshot saved.</p> : null}
      </div>
    </section>
  );
}
