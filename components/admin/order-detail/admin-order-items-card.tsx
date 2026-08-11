import type { AdminOrderDetailItem } from "@/lib/application/admin/admin-order-detail.types";
import { formatMoney } from "@/lib/catalog";

export function AdminOrderItemsCard({ items }: { items: AdminOrderDetailItem[] }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Products</h2>
      <div className="mt-4 grid gap-3">
        {items.map((item) => (
          <article key={item.id} className="rounded border border-black/10 bg-zinc-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-black">{item.productName}</h3>
                <p className="mt-1 font-mono text-xs font-bold text-steel">{item.sku}</p>
                <p className="mt-2 text-sm font-bold text-steel">{formatSizeSummary(item.attributes)}</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="font-black">
                  {item.qty} x {formatMoney(item.unitPrice)}
                </p>
                <p className="mt-1 text-sm font-bold text-steel">Line total {formatMoney(item.lineTotal)}</p>
              </div>
            </div>
            {(item.lineSubtotal !== null || item.lineDiscount !== null) ? (
              <dl className="mt-4 grid gap-2 text-xs font-bold text-steel sm:grid-cols-2">
                {item.lineSubtotal !== null ? <Meta label="Line subtotal" value={formatMoney(item.lineSubtotal)} /> : null}
                {item.lineDiscount !== null ? <Meta label="Line discount" value={formatMoney(item.lineDiscount)} /> : null}
              </dl>
            ) : null}
          </article>
        ))}
        {items.length === 0 ? <p className="text-sm font-bold text-steel">No item rows saved yet.</p> : null}
      </div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.12em]">{label}</dt>
      <dd className="mt-1 break-all text-ink">{value}</dd>
    </div>
  );
}

function formatSizeSummary(attributes: Record<string, unknown>) {
  const driver = attributes.driver_length;
  const passenger = attributes.passenger_length;
  const rear = attributes.rear_length;
  return [driver ? `Driver ${driver}` : "", passenger ? `Passenger ${passenger}` : "", rear ? `Rear ${rear}` : ""].filter(Boolean).join(" / ") || "No stored size attributes";
}
