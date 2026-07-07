import Link from "next/link";
import { Boxes, ClipboardList, FileText, PackageCheck, PackagePlus, ShieldAlert, Wrench } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { checkAdminAccess, loadAdminDashboardData, type AdminOrder } from "@/lib/queries/admin";
import {
  updateFulfillmentAction,
  updateProductContentAction,
  updateRearAddonAction,
  updateVariantAction,
  updateWiperSetAction
} from "./actions";

export const dynamic = "force-dynamic";

type AdminSearchParams = {
  tab?: string;
};

const tabs = [
  { id: "orders", label: "Orders" },
  { id: "fulfillment", label: "Wiper fulfillment" },
  { id: "products", label: "Products" },
  { id: "content", label: "Content" }
];

export default async function AdminPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const params = await searchParams;
  const activeTab = tabs.some((tab) => tab.id === params.tab) ? params.tab! : "orders";
  const access = await checkAdminAccess();

  if (!access.ok) {
    return <AdminGate reason={access.reason} email={access.email} />;
  }

  const { orders, products, variants, wiperSets, rearAddons } = await loadAdminDashboardData();
  const pendingFulfillment = orders.filter((order) => order.fulfillment?.connectorStatus === "pending").length;
  const paidOrders = orders.filter((order) => order.status === "paid").length;

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Admin</p>
          <h1 className="mt-2 text-4xl font-black">Operations workbench</h1>
          <p className="mt-3 text-sm font-bold text-steel">Signed in as {access.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={`/admin?tab=${tab.id}` as never}
              className={`rounded px-4 py-2 text-sm font-black ${
                activeTab === tab.id ? "bg-ink text-white" : "border border-black/10 bg-white text-steel hover:border-ink"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric icon={<ClipboardList className="h-5 w-5" />} label="Paid orders" value={String(paidOrders)} />
        <Metric icon={<Wrench className="h-5 w-5" />} label="Pending connectors" value={String(pendingFulfillment)} />
        <Metric icon={<PackagePlus className="h-5 w-5" />} label="Products" value={String(products.length)} />
        <Metric icon={<Boxes className="h-5 w-5" />} label="Wiper pair SKUs" value={String(wiperSets.length)} />
      </section>

      {activeTab === "orders" ? <OrdersPanel orders={orders} /> : null}
      {activeTab === "fulfillment" ? <FulfillmentPanel orders={orders} /> : null}
      {activeTab === "products" ? (
        <ProductsPanel variants={variants} wiperSets={wiperSets} rearAddons={rearAddons} />
      ) : null}
      {activeTab === "content" ? <ContentPanel products={products} /> : null}
    </main>
  );
}

function AdminGate({ reason, email }: { reason: "signed_out" | "forbidden" | "not_configured"; email?: string }) {
  const title =
    reason === "not_configured" ? "Admin is not configured" : reason === "forbidden" ? "Admin access denied" : "Sign in required";
  const body =
    reason === "not_configured"
      ? "Set ADMIN_EMAILS in Vercel and .env.local, for example sales@nexauto.co.nz."
      : reason === "forbidden"
        ? `${email ?? "This account"} is not included in ADMIN_EMAILS.`
        : "Sign in with an admin email before opening this hidden admin route.";

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-lg border border-black/10 bg-white p-8 shadow-panel">
        <div className="flex items-center gap-3 text-signal">
          <ShieldAlert className="h-6 w-6" />
          <p className="text-sm font-black uppercase tracking-[0.18em]">Admin</p>
        </div>
        <h1 className="mt-4 text-3xl font-black">{title}</h1>
        <p className="mt-3 leading-7 text-steel">{body}</p>
        <Link href="/account" className="mt-6 inline-flex h-11 items-center justify-center rounded bg-ink px-5 font-black text-white">
          Go to account
        </Link>
      </div>
    </main>
  );
}

function OrdersPanel({ orders }: { orders: AdminOrder[] }) {
  return (
    <section className="mt-8 rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-black">Orders</h2>
      <div className="mt-5 grid gap-4">
        {orders.map((order) => (
          <article key={order.id} className="rounded border border-black/10 bg-zinc-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="font-mono text-xs font-bold text-steel">{order.id}</p>
                <h3 className="mt-1 text-lg font-black">{order.email ?? "No email"}</h3>
                <p className="mt-1 text-sm font-bold text-steel">{new Date(order.createdAt).toLocaleString("en-NZ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{order.status}</Badge>
                <Badge>{formatMoney(order.subtotal)}</Badge>
                {order.fulfillment ? <Badge>{order.fulfillment.connectorStatus}</Badge> : null}
              </div>
            </div>
            {order.vehicle ? (
              <p className="mt-3 text-sm font-black">
                Vehicle: {order.vehicle.make} {order.vehicle.model} {order.vehicle.year}
              </p>
            ) : null}
            <div className="mt-4 grid gap-2">
              {order.items.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 rounded bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-black">{item.productName}</p>
                    <p className="font-mono text-xs font-bold text-steel">{item.sku}</p>
                  </div>
                  <p className="font-black">
                    {item.qty} x {formatMoney(item.unitPrice)}
                  </p>
                </div>
              ))}
            </div>
          </article>
        ))}
        {orders.length === 0 ? <EmptyState text="No orders yet." /> : null}
      </div>
    </section>
  );
}

function FulfillmentPanel({ orders }: { orders: AdminOrder[] }) {
  const fulfillments = orders.filter((order) => order.fulfillment);

  return (
    <section className="mt-8 grid gap-4">
      {fulfillments.map((order) => {
        const fulfillment = order.fulfillment!;
        return (
          <article key={fulfillment.id} className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Order {order.id.slice(0, 8)}</p>
                <h2 className="mt-1 text-xl font-black">{order.email ?? "No email"}</h2>
                {order.vehicle ? (
                  <p className="mt-2 text-sm font-bold text-steel">
                    {order.vehicle.make} {order.vehicle.model} {order.vehicle.year}
                  </p>
                ) : null}
              </div>
              <Badge>{fulfillment.connectorStatus}</Badge>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Spec label="Driver" value={formatLength(fulfillment.driverLengthIn)} />
              <Spec label="Passenger" value={formatLength(fulfillment.passengerLengthIn)} />
              <Spec label="Rear" value={formatLength(fulfillment.rearLengthIn)} />
            </div>

            <form action={updateFulfillmentAction} className="mt-5 grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
              <input type="hidden" name="fulfillmentId" value={fulfillment.id} />
              <Field label="Driver connector" name="driverConnector" defaultValue={fulfillment.driverConnector ?? ""} />
              <Field label="Passenger connector" name="passengerConnector" defaultValue={fulfillment.passengerConnector ?? ""} />
              <Field label="Rear connector" name="rearConnector" defaultValue={fulfillment.rearConnector ?? ""} />
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Status</span>
                <select
                  name="connectorStatus"
                  defaultValue={fulfillment.connectorStatus}
                  className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold"
                >
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
                <textarea
                  name="adminNote"
                  defaultValue={fulfillment.adminNote ?? ""}
                  className="mt-2 min-h-20 w-full rounded border border-black/10 p-3 text-sm font-bold"
                />
              </label>
            </form>
          </article>
        );
      })}
      {fulfillments.length === 0 ? <EmptyState text="No wiper fulfillment rows yet." /> : null}
    </section>
  );
}

function ProductsPanel({
  variants,
  wiperSets,
  rearAddons
}: {
  variants: Awaited<ReturnType<typeof loadAdminDashboardData>>["variants"];
  wiperSets: Awaited<ReturnType<typeof loadAdminDashboardData>>["wiperSets"];
  rearAddons: Awaited<ReturnType<typeof loadAdminDashboardData>>["rearAddons"];
}) {
  return (
    <section className="mt-8 grid gap-6">
      <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">Wiper pair SKU pricing</h2>
        <div className="mt-5 grid gap-3">
          {wiperSets.slice(0, 24).map((wiperSet) => (
            <form key={wiperSet.id} action={updateWiperSetAction} className="grid gap-3 rounded border border-black/10 bg-zinc-50 p-3 md:grid-cols-[1fr_120px_100px_auto] md:items-end">
              <input type="hidden" name="wiperSetId" value={wiperSet.id} />
              <div>
                <p className="font-black">{wiperSet.name}</p>
                <p className="font-mono text-xs font-bold text-steel">{wiperSet.sku}</p>
              </div>
              <Field label="Price" name="price" type="number" step="0.01" defaultValue={String(wiperSet.price)} />
              <Toggle label="Active" name="active" defaultChecked={wiperSet.active} />
              <button type="submit" className="h-11 rounded bg-ink px-4 text-sm font-black text-white">Save</button>
            </form>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Rear add-ons</h2>
          <div className="mt-5 grid gap-3">
            {rearAddons.map((addon) => (
              <form key={addon.id} action={updateRearAddonAction} className="grid gap-3 rounded border border-black/10 bg-zinc-50 p-3 md:grid-cols-[1fr_120px_100px_auto] md:items-end">
                <input type="hidden" name="rearAddonId" value={addon.id} />
                <div>
                  <p className="font-black">{addon.name}</p>
                  <p className="text-xs font-bold text-steel">{formatLength(addon.rearLengthIn)}</p>
                </div>
                <Field label="Price" name="price" type="number" step="0.01" defaultValue={String(addon.price)} />
                <Toggle label="Active" name="active" defaultChecked={addon.active} />
                <button type="submit" className="h-11 rounded bg-ink px-4 text-sm font-black text-white">Save</button>
              </form>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Single blade stock</h2>
          <div className="mt-5 grid gap-3">
            {variants.map((variant) => (
              <form key={variant.id} action={updateVariantAction} className="grid gap-3 rounded border border-black/10 bg-zinc-50 p-3 md:grid-cols-[1fr_90px_90px_90px] md:items-end">
                <input type="hidden" name="variantId" value={variant.id} />
                <div>
                  <p className="font-black">{variant.productName}</p>
                  <p className="font-mono text-xs font-bold text-steel">{variant.sku}</p>
                </div>
                <Field label="Price" name="price" type="number" step="0.01" defaultValue={String(variant.price)} />
                <Field label="Stock" name="stock" type="number" defaultValue={String(variant.stock)} />
                <div className="flex items-end gap-3">
                  <Toggle label="Active" name="active" defaultChecked={variant.active} />
                  <button type="submit" className="h-11 rounded bg-ink px-4 text-sm font-black text-white">Save</button>
                </div>
              </form>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ContentPanel({ products }: { products: Awaited<ReturnType<typeof loadAdminDashboardData>>["products"] }) {
  return (
    <section className="mt-8 grid gap-4">
      <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-signal" />
          <h2 className="text-xl font-black">Product content</h2>
        </div>
        <p className="mt-3 text-sm font-bold leading-6 text-steel">
          Light content management for product copy and video links. Full page CMS can wait until the storefront copy stabilizes.
        </p>
      </div>

      {products.map((product) => (
        <form key={product.id} action={updateProductContentAction} className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
          <input type="hidden" name="productId" value={product.id} />
          <div className="grid gap-4 lg:grid-cols-[1fr_140px_120px]">
            <Field label="Name" name="name" defaultValue={product.name} />
            <Field label="Price" name="price" type="number" step="0.01" defaultValue={String(product.price)} />
            <Toggle label="Active" name="active" defaultChecked={product.active} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.85fr]">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Description</span>
              <textarea
                name="description"
                defaultValue={product.description}
                className="mt-2 min-h-28 w-full rounded border border-black/10 p-3 text-sm font-bold"
              />
            </label>
            <Field label="Video URL" name="videoUrl" defaultValue={product.videoUrl ?? ""} />
          </div>
          <button type="submit" className="mt-4 h-11 rounded bg-ink px-5 text-sm font-black text-white">Save content</button>
        </form>
      ))}
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3 text-steel">
        {icon}
        <span className="text-sm font-black uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="mt-4 text-3xl font-black">{value}</p>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-steel">{children}</span>;
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black/10 bg-zinc-50 p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  step
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</span>
      <input
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold"
      />
    </label>
  );
}

function Toggle({ label, name, defaultChecked }: { label: string; name: string; defaultChecked: boolean }) {
  return (
    <label className="flex h-11 items-center gap-2">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="h-4 w-4 accent-red-600" />
      <span className="text-sm font-black">{label}</span>
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-black/10 bg-white p-8 text-center font-bold text-steel">{text}</div>;
}

function formatLength(value: number | null) {
  return value ? `${value}"` : "N/A";
}
