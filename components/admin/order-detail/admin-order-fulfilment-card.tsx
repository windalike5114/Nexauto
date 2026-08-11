import type { AdminOrderDetailFulfilment, AdminOrderDetailItem, AdminOrderDetailVehicleSnapshot } from "@/lib/application/admin/admin-order-detail.types";

export function AdminOrderFulfilmentCard({
  fulfilments,
  items,
  vehicles,
  action
}: {
  fulfilments: AdminOrderDetailFulfilment[];
  items: AdminOrderDetailItem[];
  vehicles: AdminOrderDetailVehicleSnapshot[];
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Wiper fulfilment</h2>
      <p className="mt-1 text-sm font-bold text-steel">Historical order snapshots are read-only. Connector fields below use the existing editable fulfilment form.</p>
      <div className="mt-4 grid gap-4">
        {fulfilments.map((fulfilment) => {
          const item = items.find((candidate) => candidate.id === fulfilment.relationship.itemId);
          const vehicle = vehicles.find((candidate) => candidate.vehicleApplicationId && candidate.vehicleApplicationId === fulfilment.vehicleApplicationId);
          return (
            <article key={fulfilment.id} className="rounded border border-black/10 bg-zinc-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-black">{item?.sku ?? fulfilment.relationship.label}</h3>
                  <p className="mt-1 text-sm font-bold text-steel">{vehicle?.label ?? fulfilment.relationship.label}</p>
                </div>
                <span className="w-fit rounded bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-steel ring-1 ring-black/10">{fulfilment.connectorStatus}</span>
              </div>
              <dl className="mt-4 grid gap-2 text-sm font-bold text-steel sm:grid-cols-3">
                <Meta label="Driver" value={formatLength(fulfilment.driverLengthIn)} />
                <Meta label="Passenger" value={formatLength(fulfilment.passengerLengthIn)} />
                <Meta label="Rear" value={formatLength(fulfilment.rearLengthIn)} />
              </dl>
              <form action={action} className="mt-5 grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
                <input type="hidden" name="fulfillmentId" value={fulfilment.id} />
                <Field label="Driver connector" name="driverConnector" defaultValue={fulfilment.driverConnector ?? ""} />
                <Field label="Passenger connector" name="passengerConnector" defaultValue={fulfilment.passengerConnector ?? ""} />
                <Field label="Rear connector" name="rearConnector" defaultValue={fulfilment.rearConnector ?? ""} />
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Status</span>
                  <select name="connectorStatus" defaultValue={fulfilment.connectorStatus} className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold">
                    {["pending", "selected", "packed", "fulfilled", "issue"].map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="mt-6 h-11 rounded bg-ink px-5 text-sm font-black text-white hover:bg-black lg:mt-7">
                  Save
                </button>
                <label className="block lg:col-span-5">
                  <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Admin note</span>
                  <textarea name="adminNote" defaultValue={fulfilment.adminNote ?? ""} className="mt-2 min-h-20 w-full rounded border border-black/10 p-3 text-sm font-bold" />
                </label>
              </form>
            </article>
          );
        })}
        {fulfilments.length === 0 ? <p className="text-sm font-bold text-steel">No wiper fulfilment row saved yet. It is normally created when Stripe confirms payment for wiper pair orders.</p> : null}
      </div>
    </section>
  );
}

function Field({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</span>
      <input name={name} defaultValue={defaultValue} className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold" />
    </label>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-black uppercase tracking-[0.12em]">{label}</dt>
      <dd className="mt-1 break-all text-ink">{value}</dd>
    </div>
  );
}

function formatLength(value: number | null) {
  return value === null ? "Not stored" : `${value}" / ${Math.round(value * 25.4)} mm`;
}
