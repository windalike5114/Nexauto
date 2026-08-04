import type { AdminOrderDetailVehicleSnapshot } from "@/lib/application/admin/admin-order-detail.types";

export function AdminOrderVehiclesCard({ vehicles }: { vehicles: AdminOrderDetailVehicleSnapshot[] }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Vehicle snapshots</h2>
      <div className="mt-4 grid gap-3">
        {vehicles.map((vehicle) => (
          <article key={vehicle.id} className="rounded border border-black/10 bg-zinc-50 p-4">
            <h3 className="font-black">{vehicle.label}</h3>
            <dl className="mt-3 grid gap-2 text-xs font-bold text-steel">
              <Meta label="Vehicle application ID" value={vehicle.vehicleApplicationId ?? "Not attached"} mono />
              <Meta label="Customer vehicle ID" value={vehicle.customerVehicleId ?? "Not attached"} mono />
              <Meta label="Fitment range" value={[vehicle.startRaw, vehicle.endRaw].filter(Boolean).join(" - ") || "Not stored"} />
            </dl>
          </article>
        ))}
        {vehicles.length === 0 ? <p className="text-sm font-bold text-steel">No vehicle snapshot saved.</p> : null}
      </div>
    </section>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.12em]">{label}</dt>
      <dd className={`mt-1 break-all text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
