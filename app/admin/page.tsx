import Link from "next/link";
import {
  BarChart3,
  CarFront,
  ClipboardList,
  FileText,
  Inbox,
  Mail,
  PackagePlus,
  Search,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Store,
  Users,
  Wrench
} from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import {
  checkAdminAccess,
  loadAdminContentData,
  loadAdminCustomersData,
  loadAdminEmailEventsData,
  loadAdminEnquiriesData,
  loadAdminOrdersData,
  loadAdminOverviewData,
  loadAdminProductsData,
  type AdminCustomer,
  type AdminEmailEvent,
  type AdminEnquiry,
  type AdminOrder,
  type AdminProduct,
  type AdminRearAddon,
  type AdminVariant,
  type AdminWiperSet
} from "@/lib/queries/admin";
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
  {
    group: "Admin",
    items: [{ id: "overview", label: "Overview", icon: BarChart3 }]
  },
  {
    group: "Orders",
    items: [
      { id: "orders", label: "Orders", icon: ShoppingCart },
      { id: "fulfillment", label: "Wiper fulfillment", icon: Wrench }
    ]
  },
  {
    group: "Catalog",
    items: [
      { id: "products", label: "Products", icon: PackagePlus },
      { id: "fitment", label: "Vehicle fitment", icon: CarFront }
    ]
  },
  {
    group: "Customers",
    items: [
      { id: "customers", label: "Customers", icon: Users },
      { id: "enquiries", label: "Enquiries", icon: Inbox }
    ]
  },
  {
    group: "System",
    items: [
      { id: "emails", label: "Emails", icon: Mail },
      { id: "content", label: "Content", icon: FileText },
      { id: "settings", label: "Settings", icon: Settings }
    ]
  }
];

const flatTabs = tabs.flatMap((group) => group.items);

export default async function AdminPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const params = await searchParams;
  const activeTab = flatTabs.some((tab) => tab.id === params.tab) ? params.tab! : "overview";
  const access = await checkAdminAccess();

  if (!access.ok) {
    return <AdminGate reason={access.reason} email={access.email} />;
  }

  const tabData = await loadAdminTabData(activeTab);

  return (
    <main className="min-h-screen bg-[#F6F7F9] text-ink">
      <div className="mx-auto grid max-w-[1600px] gap-0 lg:grid-cols-[260px_1fr]">
        <AdminSidebar activeTab={activeTab} />
        <section className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          <AdminTopBar email={access.email} activeTab={activeTab} />

          {activeTab === "overview" ? (
            <OverviewPanel
              orders={tabData.orders}
              variants={tabData.variants}
              emailEvents={tabData.emailEvents}
              customers={tabData.customers}
              enquiries={tabData.enquiries}
            />
          ) : null}
          {activeTab === "orders" ? <OrdersPanel orders={tabData.orders} /> : null}
          {activeTab === "fulfillment" ? <FulfillmentPanel orders={tabData.orders} /> : null}
          {activeTab === "products" ? (
            <ProductsPanel variants={tabData.variants} wiperSets={tabData.wiperSets} rearAddons={tabData.rearAddons} />
          ) : null}
          {activeTab === "fitment" ? <PlaceholderPanel title="Vehicle fitment" text="Fitment review tools are reserved for the next admin phase. Current fitment lookup remains database-driven on the storefront." /> : null}
          {activeTab === "customers" ? <CustomersPanel customers={tabData.customers} /> : null}
          {activeTab === "enquiries" ? <EnquiriesPanel enquiries={tabData.enquiries} /> : null}
          {activeTab === "content" ? <ContentPanel products={tabData.products} /> : null}
          {activeTab === "emails" ? <EmailHistoryPanel emailEvents={tabData.emailEvents} /> : null}
          {activeTab === "settings" ? <SettingsPanel /> : null}
        </section>
      </div>
    </main>
  );
}

async function loadAdminTabData(activeTab: string) {
  const empty = {
    orders: [] as AdminOrder[],
    products: [] as AdminProduct[],
    variants: [] as AdminVariant[],
    wiperSets: [] as AdminWiperSet[],
    rearAddons: [] as AdminRearAddon[],
    emailEvents: [] as AdminEmailEvent[],
    customers: [] as AdminCustomer[],
    enquiries: [] as AdminEnquiry[]
  };

  if (activeTab === "overview") {
    return { ...empty, ...(await loadAdminOverviewData()) };
  }

  if (activeTab === "orders" || activeTab === "fulfillment") {
    return { ...empty, orders: await loadAdminOrdersData() };
  }

  if (activeTab === "products") {
    return { ...empty, ...(await loadAdminProductsData()) };
  }

  if (activeTab === "content") {
    return { ...empty, products: await loadAdminContentData() };
  }

  if (activeTab === "customers") {
    return { ...empty, customers: await loadAdminCustomersData() };
  }

  if (activeTab === "enquiries") {
    return { ...empty, enquiries: await loadAdminEnquiriesData() };
  }

  if (activeTab === "emails") {
    return { ...empty, emailEvents: await loadAdminEmailEventsData() };
  }

  return empty;
}

function AdminSidebar({ activeTab }: { activeTab: string }) {
  return (
    <aside className="border-b border-black/10 bg-white px-4 py-5 lg:sticky lg:top-0 lg:min-h-screen lg:border-b-0 lg:border-r">
      <div className="mb-6">
        <p className="text-lg font-black">NexAutoParts</p>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-signal">Admin</p>
      </div>
      <nav className="grid gap-5">
        {tabs.map((group) => (
          <div key={group.group}>
            <p className="mb-2 px-2 text-[11px] font-black uppercase tracking-[0.16em] text-steel">{group.group}</p>
            <div className="grid gap-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <Link
                    key={item.id}
                    href={`/admin?tab=${item.id}` as never}
                    className={`flex h-10 items-center gap-3 rounded-lg border-l-4 px-3 text-sm font-black transition ${
                      active
                        ? "border-signal bg-red-50 text-ink"
                        : "border-transparent text-steel hover:bg-zinc-50 hover:text-ink"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function AdminTopBar({ email, activeTab }: { email: string; activeTab: string }) {
  const activeLabel = flatTabs.find((tab) => tab.id === activeTab)?.label ?? "Overview";

  return (
    <header className="mb-6 flex flex-col gap-4 rounded-xl border border-black/10 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-steel">{new Date().toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        <h1 className="mt-1 text-2xl font-black">{activeLabel}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-sm font-black text-steel hover:border-ink">
          <Store className="h-4 w-4" />
          View Store
        </Link>
        <div className="hidden h-10 items-center gap-2 rounded-lg border border-black/10 bg-zinc-50 px-3 text-sm font-bold text-steel md:flex">
          <Search className="h-4 w-4" />
          Search
        </div>
        <div className="rounded-lg bg-ink px-3 py-2 text-sm font-black text-white">{email}</div>
      </div>
    </header>
  );
}

function OverviewPanel({
  orders,
  variants,
  emailEvents,
  customers,
  enquiries
}: {
  orders: AdminOrder[];
  variants: AdminVariant[];
  emailEvents: AdminEmailEvent[];
  customers: AdminCustomer[];
  enquiries: AdminEnquiry[];
}) {
  const today = new Date().toDateString();
  const todaysOrders = orders.filter((order) => new Date(order.createdAt).toDateString() === today);
  const todaysSales = todaysOrders.reduce((total, order) => total + order.subtotal, 0);
  const paidOrders = orders.filter((order) => order.status === "paid");
  const averageOrderValue = paidOrders.length ? paidOrders.reduce((total, order) => total + order.subtotal, 0) / paidOrders.length : 0;
  const pendingFulfillment = orders.filter((order) => order.fulfillment?.connectorStatus === "pending");
  const failedPayments = orders.filter((order) => ["failed", "payment_failed"].includes(order.status));
  const lowStock = variants.filter((variant) => variant.stock <= 5);
  const failedEmails = emailEvents.filter((event) => ["failed", "bounced", "complained"].includes(event.status));
  const newEnquiries = enquiries.filter((enquiry) => enquiry.status === "new");

  return (
    <section className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<BarChart3 className="h-5 w-5" />} label="Today's Sales" value={formatMoney(todaysSales)} detail={`${todaysOrders.length} orders today`} />
        <Metric icon={<ClipboardList className="h-5 w-5" />} label="Orders" value={String(orders.length)} detail={`${pendingFulfillment.length} awaiting fulfilment`} />
        <Metric icon={<ShoppingCart className="h-5 w-5" />} label="Average Order Value" value={formatMoney(averageOrderValue)} detail="Paid orders only" />
        <Metric icon={<Users className="h-5 w-5" />} label="Customers" value={String(customers.length)} detail={`${newEnquiries.length} new enquiries`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title="Needs Attention">
          <AttentionRow label="Orders awaiting fulfilment" value={pendingFulfillment.length} href="/admin?tab=fulfillment" />
          <AttentionRow label="Failed payments" value={failedPayments.length} href="/admin?tab=orders" />
          <AttentionRow label="Low-stock products" value={lowStock.length} href="/admin?tab=products" />
          <AttentionRow label="New enquiries" value={newEnquiries.length} href="/admin?tab=enquiries" />
          <AttentionRow label="Failed emails" value={failedEmails.length} href="/admin?tab=emails" />
        </Panel>

        <Panel title="Order Status">
          <StatusCount label="Paid" count={orders.filter((order) => order.status === "paid").length} />
          <StatusCount label="Pending" count={orders.filter((order) => order.status === "pending").length} />
          <StatusCount label="Processing" count={orders.filter((order) => order.fulfillment?.connectorStatus === "selected").length} />
          <StatusCount label="Shipped / fulfilled" count={orders.filter((order) => ["packed", "fulfilled"].includes(order.fulfillment?.connectorStatus ?? "")).length} />
          <StatusCount label="Cancelled" count={orders.filter((order) => order.status === "cancelled").length} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Panel title="Recent Orders">
          <CompactOrders orders={orders.slice(0, 6)} />
        </Panel>
        <Panel title="Low Stock">
          <div className="grid gap-3">
            {lowStock.slice(0, 8).map((variant) => (
              <div key={variant.id} className="flex items-center justify-between rounded-lg border border-black/10 bg-zinc-50 p-3">
                <div>
                  <p className="font-black">{variant.sku}</p>
                  <p className="text-xs font-bold text-steel">{variant.productName}</p>
                </div>
                <Badge>{variant.stock} left</Badge>
              </div>
            ))}
            {lowStock.length === 0 ? <EmptyState text="No low-stock items." /> : null}
          </div>
        </Panel>
      </div>
    </section>
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
  variants: AdminVariant[];
  wiperSets: AdminWiperSet[];
  rearAddons: AdminRearAddon[];
}) {
  return (
    <section className="mt-8 grid gap-6">
      <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">Wiper pair SKU pricing</h2>
        <div className="mt-5 grid gap-3">
          {wiperSets.slice(0, 24).map((wiperSet) => (
            <form key={wiperSet.id} action={updateWiperSetAction} className="grid gap-3 rounded border border-black/10 bg-zinc-50 p-3 md:grid-cols-[1fr_120px_120px_100px_auto] md:items-end">
              <input type="hidden" name="wiperSetId" value={wiperSet.id} />
              <div>
                <p className="font-black">{wiperSet.name}</p>
                <p className="font-mono text-xs font-bold text-steel">{wiperSet.sku}</p>
              </div>
              <Field label="Compare at" name="compareAtPrice" type="number" step="0.01" defaultValue={String(wiperSet.compareAtPrice ?? "")} />
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

function ContentPanel({ products }: { products: AdminProduct[] }) {
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
          <label className="mt-4 block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Detail sections JSON</span>
            <textarea
              name="detailSections"
              defaultValue={JSON.stringify(product.detailSections, null, 2)}
              className="mt-2 min-h-40 w-full rounded border border-black/10 p-3 font-mono text-xs font-bold"
            />
          </label>
          <button type="submit" className="mt-4 h-11 rounded bg-ink px-5 text-sm font-black text-white">Save content</button>
        </form>
      ))}
    </section>
  );
}

function EmailHistoryPanel({ emailEvents }: { emailEvents: AdminEmailEvent[] }) {
  return (
    <section className="mt-8 rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-black">Email history</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-steel">
            Transactional email log for contact enquiries, order confirmations, and Resend delivery events.
          </p>
        </div>
        <Badge>{emailEvents.length} recent</Badge>
      </div>

      <div className="mt-5 overflow-hidden rounded border border-black/10">
        <div className="hidden grid-cols-[150px_1fr_170px_110px_130px] gap-3 border-b border-black/10 bg-zinc-50 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-steel lg:grid">
          <span>Type</span>
          <span>Subject</span>
          <span>Recipient</span>
          <span>Status</span>
          <span>Created</span>
        </div>
        <div className="divide-y divide-black/10">
          {emailEvents.map((event) => (
            <article key={event.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[150px_1fr_170px_110px_130px] lg:items-start">
              <div>
                <p className="font-black">{event.type.replaceAll("_", " ")}</p>
                {event.orderId ? <p className="mt-1 font-mono text-xs font-bold text-steel">{event.orderId.slice(0, 8)}</p> : null}
              </div>
              <div>
                <p className="font-bold">{event.subject ?? "No subject"}</p>
                {event.errorCode ? <p className="mt-1 text-xs font-bold text-signal">{event.errorCode}</p> : null}
                {event.resendEmailId ? <p className="mt-1 font-mono text-xs text-steel">{event.resendEmailId}</p> : null}
              </div>
              <p className="break-all font-bold text-steel">{event.recipient}</p>
              <Badge>{event.status}</Badge>
              <p className="font-bold text-steel">{new Date(event.createdAt).toLocaleDateString("en-NZ")}</p>
            </article>
          ))}
        </div>
      </div>
      {emailEvents.length === 0 ? <EmptyState text="No email events yet. Run the email_events SQL migration before expecting live records." /> : null}
    </section>
  );
}

function CustomersPanel({ customers }: { customers: AdminCustomer[] }) {
  return (
    <Panel title="Customers" className="mt-0">
      <div className="overflow-hidden rounded-lg border border-black/10">
        <div className="hidden grid-cols-[1fr_220px_90px_130px_120px] gap-3 border-b border-black/10 bg-zinc-50 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-steel lg:grid">
          <span>Customer</span>
          <span>Email</span>
          <span>Orders</span>
          <span>Total Spent</span>
          <span>Joined</span>
        </div>
        <div className="divide-y divide-black/10">
          {customers.map((customer) => (
            <article key={customer.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1fr_220px_90px_130px_120px] lg:items-center">
              <div>
                <p className="font-black">{customer.name ?? "Customer"}</p>
                <p className="font-mono text-xs font-bold text-steel">{customer.id.slice(0, 8)}</p>
              </div>
              <p className="break-all font-bold text-steel">{customer.email}</p>
              <p className="font-black">{customer.orderCount}</p>
              <p className="font-black">{formatMoney(customer.totalSpent)}</p>
              <p className="font-bold text-steel">{new Date(customer.joinedAt).toLocaleDateString("en-NZ")}</p>
            </article>
          ))}
        </div>
      </div>
      {customers.length === 0 ? <EmptyState text="No customers yet." /> : null}
    </Panel>
  );
}

function EnquiriesPanel({ enquiries }: { enquiries: AdminEnquiry[] }) {
  return (
    <Panel title="Enquiries" className="mt-0">
      <div className="grid gap-4">
        {enquiries.map((enquiry) => (
          <article key={enquiry.id} className="rounded-lg border border-black/10 bg-zinc-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="font-black">{enquiry.name}</p>
                <p className="mt-1 break-all text-sm font-bold text-steel">{enquiry.email}</p>
                {enquiry.partOrSku ? <p className="mt-2 font-mono text-xs font-black text-signal">{enquiry.partOrSku}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{enquiry.status.replaceAll("_", " ")}</Badge>
                <Badge>{new Date(enquiry.createdAt).toLocaleDateString("en-NZ")}</Badge>
              </div>
            </div>
            <p className="mt-4 rounded-lg bg-white p-3 text-sm font-bold leading-6 text-ink">{enquiry.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`mailto:${enquiry.email}`} className="rounded bg-ink px-3 py-2 text-xs font-black text-white">
                Reply by Email
              </a>
              {enquiry.sourceUrl ? (
                <a href={enquiry.sourceUrl} className="rounded border border-black/10 bg-white px-3 py-2 text-xs font-black text-steel">
                  Source Page
                </a>
              ) : null}
            </div>
          </article>
        ))}
        {enquiries.length === 0 ? <EmptyState text="No enquiries yet. Run the contact_enquiries SQL migration before expecting live records." /> : null}
      </div>
    </Panel>
  );
}

function SettingsPanel() {
  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <Panel title="Store Settings" className="mt-0">
        <ReadOnlySetting label="Business Name" value="NexAutoParts" />
        <ReadOnlySetting label="Website URL" value="https://nexautoparts.co.nz" />
        <ReadOnlySetting label="Support Email" value="support@nexautoparts.co.nz" />
        <ReadOnlySetting label="Order Email" value="orders@nexautoparts.co.nz" />
      </Panel>
      <Panel title="Integrations" className="mt-0">
        <ReadOnlySetting label="Supabase" value="Connected via server environment" />
        <ReadOnlySetting label="Stripe" value="Connected via webhook" />
        <ReadOnlySetting label="Resend" value="Connected when RESEND_API_KEY is set" />
        <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm font-bold leading-6 text-steel">
          Secret keys are intentionally not shown in admin. Manage them in Vercel environment variables.
        </p>
      </Panel>
    </section>
  );
}

function PlaceholderPanel({ title, text }: { title: string; text: string }) {
  return (
    <Panel title={title} className="mt-0">
      <p className="text-sm font-bold leading-6 text-steel">{text}</p>
    </Panel>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-black/10 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="text-xl font-black">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function AttentionRow({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href as never} className="flex items-center justify-between rounded-lg border border-black/10 bg-zinc-50 p-3 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-sm">
      <div>
        <p className="font-black">{value}</p>
        <p className="text-sm font-bold text-steel">{label}</p>
      </div>
      <span className="text-sm font-black text-signal">View</span>
    </Link>
  );
}

function StatusCount({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between border-b border-black/10 py-3 last:border-b-0">
      <span className="font-bold text-steel">{label}</span>
      <span className="font-black">{count}</span>
    </div>
  );
}

function CompactOrders({ orders }: { orders: AdminOrder[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-black/10">
      <div className="hidden grid-cols-[120px_1fr_120px_110px_130px] gap-3 border-b border-black/10 bg-zinc-50 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-steel lg:grid">
        <span>Order</span>
        <span>Customer</span>
        <span>Total</span>
        <span>Payment</span>
        <span>Fulfilment</span>
      </div>
      <div className="divide-y divide-black/10">
        {orders.map((order) => (
          <article key={order.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[120px_1fr_120px_110px_130px] lg:items-center">
            <p className="font-mono font-black">{formatOrderNumber(order.id)}</p>
            <p className="break-all font-bold text-steel">{order.customerName ?? order.email ?? "Guest"}</p>
            <p className="font-black">{formatMoney(order.subtotal)}</p>
            <Badge>{order.status}</Badge>
            <Badge>{order.fulfillment?.connectorStatus ?? "unfulfilled"}</Badge>
          </article>
        ))}
      </div>
      {orders.length === 0 ? <EmptyState text="No orders yet." /> : null}
    </div>
  );
}

function ReadOnlySetting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-black/10 py-3 last:border-b-0">
      <span className="text-sm font-black uppercase tracking-[0.12em] text-steel">{label}</span>
      <span className="text-right text-sm font-black">{value}</span>
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3 text-steel">
        {icon}
        <span className="text-sm font-black uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="mt-4 text-3xl font-black">{value}</p>
      {detail ? <p className="mt-2 text-sm font-bold text-steel">{detail}</p> : null}
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

function formatOrderNumber(orderId: string) {
  return `#NXA${orderId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}
