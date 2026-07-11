import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/catalog";
import { loadAdminOrderDetailData } from "@/lib/queries/admin";
import { updateFulfillmentAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await loadOrder(id);

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/admin?tab=orders" className="text-sm font-black text-steel hover:text-ink">
          Back to orders
        </Link>

        <div className="mt-5 rounded-lg border border-black/10 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-steel">{order.id}</p>
              <h1 className="mt-2 text-3xl font-black">Order {formatOrderNumber(order.id)}</h1>
              <p className="mt-2 text-sm font-bold text-steel">{new Date(order.createdAt).toLocaleString("en-NZ")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{order.status}</Badge>
              <Badge>{formatMoney(order.subtotal)}</Badge>
              {order.fulfillment ? <Badge>{order.fulfillment.connectorStatus}</Badge> : null}
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <InfoBlock title="Customer">
              <p className="font-black">{order.customerName ?? "No name"}</p>
              <p className="mt-1 text-sm font-bold text-steel">{order.email ?? "No email"}</p>
            </InfoBlock>
            <InfoBlock title="Payment">
              <p className="text-sm font-bold text-steel">Stripe session</p>
              <p className="mt-1 break-all font-mono text-xs font-bold">{order.stripeSessionId ?? "Not attached"}</p>
              <p className="mt-3 text-sm font-bold text-steel">Payment intent</p>
              <p className="mt-1 break-all font-mono text-xs font-bold">{order.stripePaymentIntentId ?? "Not attached"}</p>
            </InfoBlock>
            <InfoBlock title="Vehicle">
              {order.vehicle ? (
                <>
                  <p className="font-black">
                    {order.vehicle.make} {order.vehicle.model}
                  </p>
                  <p className="mt-1 text-sm font-bold text-steel">{order.vehicle.year}</p>
                </>
              ) : (
                <p className="text-sm font-bold text-steel">No vehicle snapshot saved.</p>
              )}
            </InfoBlock>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_0.9fr]">
          <section className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">Items</h2>
            <div className="mt-4 grid gap-3">
              {order.items.map((item) => (
                <article key={item.id} className="rounded border border-black/10 bg-zinc-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="font-black">{item.productName}</h3>
                      <p className="mt-1 font-mono text-xs font-bold text-steel">{item.sku}</p>
                      <p className="mt-2 text-sm font-bold text-steel">{formatSizeSummary(item.attributes)}</p>
                    </div>
                    <p className="font-black">
                      {item.qty} x {formatMoney(item.unitPrice)}
                    </p>
                  </div>
                </article>
              ))}
              {order.items.length === 0 ? <p className="text-sm font-bold text-steel">No item rows saved yet.</p> : null}
            </div>
          </section>

          <section className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">Shipping address</h2>
            <p className="mt-4 whitespace-pre-wrap text-sm font-bold leading-6 text-steel">{formatAddress(order.shippingAddress)}</p>
            <h2 className="mt-8 text-xl font-black">Billing address</h2>
            <p className="mt-4 whitespace-pre-wrap text-sm font-bold leading-6 text-steel">{formatAddress(order.billingAddress)}</p>
          </section>
        </div>

        <section className="mt-5 rounded-lg border border-black/10 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black">Wiper fulfilment</h2>
          {order.fulfillment ? (
            <form action={updateFulfillmentAction} className="mt-5 grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
              <input type="hidden" name="fulfillmentId" value={order.fulfillment.id} />
              <Field label="Driver connector" name="driverConnector" defaultValue={order.fulfillment.driverConnector ?? ""} />
              <Field label="Passenger connector" name="passengerConnector" defaultValue={order.fulfillment.passengerConnector ?? ""} />
              <Field label="Rear connector" name="rearConnector" defaultValue={order.fulfillment.rearConnector ?? ""} />
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Status</span>
                <select name="connectorStatus" defaultValue={order.fulfillment.connectorStatus} className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold">
                  {["pending", "selected", "packed", "fulfilled", "issue"].map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="mt-6 h-11 rounded bg-ink px-5 text-sm font-black text-white lg:mt-7">
                Save
              </button>
              <label className="block lg:col-span-5">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Admin note</span>
                <textarea name="adminNote" defaultValue={order.fulfillment.adminNote ?? ""} className="mt-2 min-h-20 w-full rounded border border-black/10 p-3 text-sm font-bold" />
              </label>
            </form>
          ) : (
            <p className="mt-4 text-sm font-bold text-steel">No wiper fulfilment row saved yet. It will be created when Stripe confirms payment for wiper pair orders.</p>
          )}
        </section>
      </div>
    </main>
  );
}

async function loadOrder(id: string) {
  try {
    return await loadAdminOrderDetailData(id);
  } catch {
    notFound();
  }
}

function InfoBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-black/10 bg-zinc-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{title}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</span>
      <input name={name} defaultValue={defaultValue} className="mt-2 h-11 w-full rounded border border-black/10 px-3 text-sm font-bold" />
    </label>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded bg-zinc-100 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-steel">{children}</span>;
}

function formatOrderNumber(orderId: string) {
  return `NXA${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function formatAddress(address: Record<string, unknown>) {
  const line1 = address.line1;
  const line2 = address.line2;
  const city = address.city;
  const postalCode = address.postal_code;
  const country = address.country;
  return [line1, line2, city, postalCode, country].filter(Boolean).join("\n") || "Not provided";
}

function formatSizeSummary(attributes: Record<string, unknown>) {
  const driver = attributes.driver_length;
  const passenger = attributes.passenger_length;
  const rear = attributes.rear_length;
  return [driver ? `Driver ${driver}` : "", passenger ? `Passenger ${passenger}` : "", rear ? `Rear ${rear}` : ""].filter(Boolean).join(" / ");
}
