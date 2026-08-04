import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CarFront, Mail, MapPin, ReceiptText, ShieldAlert, UserRound } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { AdminConfigurationError, AdminForbiddenError, AdminInfrastructureError, AdminUnauthenticatedError } from "@/lib/domain/admin/admin-access.errors";
import { AdminCustomerDetailInvalidIdError, AdminCustomerDetailNotFoundError } from "@/lib/application/admin/get-admin-customer-detail";
import { loadAdminCustomerDetailData } from "@/lib/queries/admin";
import type { AdminCustomerDetail } from "@/lib/application/admin/admin-customer-detail.types";

export const dynamic = "force-dynamic";

export default async function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadCustomer(id);

  if (!result.ok) return <AdminCustomerError title={result.title} message={result.message} />;

  const customer = result.customer;

  return (
    <main className="min-h-screen bg-[#F6F7F9] px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-6">
        <Link href="/admin?tab=customers" className="inline-flex w-fit items-center gap-2 text-sm font-black text-steel hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          Back to customers
        </Link>

        <header className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-signal">Customer Profile</p>
              <h1 className="mt-2 text-3xl font-black">{customer.profile.name ?? "Customer"}</h1>
              <p className="mt-2 break-all text-sm font-bold text-steel">{customer.profile.email}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{customer.profile.accountType === "registered" ? "Registered account" : "Email profile"}</Badge>
              <Badge>Joined {formatDate(customer.profile.createdAt)}</Badge>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Metric label="Orders" value={String(customer.summary.orderCount)} />
          <Metric label="Total Spent" value={formatMoney(customer.summary.totalSpent)} />
          <Metric label="Saved Vehicles" value={String(customer.summary.savedVehicleCount)} />
          <Metric label="Addresses" value={String(customer.summary.addressCount)} />
          <Metric label="Claimed Orders" value={String(customer.summary.claimedOrderCount)} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Panel title="Customer">
            <ReadOnlyRow label="Profile ID" value={customer.profile.id} mono />
            <ReadOnlyRow label="Auth User" value={customer.profile.authUserId ?? "Not linked"} mono={Boolean(customer.profile.authUserId)} />
            <ReadOnlyRow label="Default Vehicle" value={customer.summary.defaultVehicleLabel ?? "None"} />
            <ReadOnlyRow label="Latest Order" value={customer.summary.latestOrderAt ? formatDateTime(customer.summary.latestOrderAt) : "None"} />
          </Panel>

          <Panel title="Recent Orders">
            <div className="grid gap-3">
              {customer.orders.map((order) => (
                <Link key={order.id} href={order.detailUrl as never} className="grid gap-3 rounded-lg border border-black/10 bg-zinc-50 p-3 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-sm sm:grid-cols-[120px_1fr_100px_90px] sm:items-center">
                  <p className="font-mono text-sm font-black">{order.orderNumber}</p>
                  <div>
                    <p className="text-sm font-black">{order.customerName ?? order.email ?? "Customer"}</p>
                    <p className="text-xs font-bold text-steel">{formatDateTime(order.createdAt)}</p>
                  </div>
                  <p className="font-black">{formatMoney(order.subtotal)}</p>
                  <Badge>{order.status}</Badge>
                </Link>
              ))}
              {customer.orders.length === 0 ? <EmptyState text="No linked orders." /> : null}
            </div>
          </Panel>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <Panel title="Saved Vehicles">
            <div className="grid gap-3">
              {customer.vehicles.map((vehicle) => (
                <div key={vehicle.id} className="rounded-lg border border-black/10 bg-zinc-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black">{vehicle.displayLabel}</p>
                      {vehicle.label ? <p className="mt-1 text-sm font-bold text-steel">{vehicle.label}</p> : null}
                    </div>
                    {vehicle.isDefault ? <Badge>Default</Badge> : null}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <SmallFact label="Source" value={vehicle.source} />
                    <SmallFact label="Last used" value={formatDateTime(vehicle.lastUsedAt)} />
                    <SmallFact label="Application" value={vehicle.applicationId ?? "Not recorded"} mono />
                    <SmallFact label="Vehicle ID" value={vehicle.id} mono />
                  </div>
                </div>
              ))}
              {customer.vehicles.length === 0 ? <EmptyState text="No saved vehicles." /> : null}
            </div>
          </Panel>

          <Panel title="Addresses">
            <div className="grid gap-3">
              {customer.addresses.map((address) => (
                <div key={address.id} className="rounded-lg border border-black/10 bg-zinc-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black">{address.label ?? "Address"}</p>
                      <p className="mt-1 text-sm font-bold text-steel">{address.recipientName}</p>
                    </div>
                    {address.isDefaultShipping ? <Badge>Default shipping</Badge> : null}
                  </div>
                  <p className="mt-3 text-sm font-bold leading-6 text-ink">{formatAddress(address)}</p>
                  {address.phone ? <p className="mt-2 text-sm font-bold text-steel">{address.phone}</p> : null}
                </div>
              ))}
              {customer.addresses.length === 0 ? <EmptyState text="No saved addresses." /> : null}
            </div>
          </Panel>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Panel title="Vehicle History from Orders">
            <div className="grid gap-3">
              {customer.vehicleHistory.map((vehicle) => (
                <Link key={vehicle.id} href={vehicle.orderDetailUrl as never} className="grid gap-3 rounded-lg border border-black/10 bg-zinc-50 p-3 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-sm sm:grid-cols-[1fr_120px_120px] sm:items-center">
                  <div>
                    <p className="font-black">{vehicle.displayLabel}</p>
                    <p className="mt-1 font-mono text-xs font-bold text-steel">{vehicle.vehicleApplicationId ?? "No application id"}</p>
                  </div>
                  <p className="font-mono text-sm font-black">{vehicle.orderNumber ?? vehicle.orderId.slice(0, 8)}</p>
                  <p className="text-sm font-bold text-steel">{formatDate(vehicle.createdAt)}</p>
                </Link>
              ))}
              {customer.vehicleHistory.length === 0 ? <EmptyState text="No order vehicle snapshots." /> : null}
            </div>
          </Panel>

          <Panel title="Order Claiming">
            <div className="grid gap-3">
              {customer.claimEvents.map((event) => (
                <div key={event.id} className="rounded-lg border border-black/10 bg-zinc-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black">{event.method.replaceAll("_", " ")}</p>
                      <p className="mt-1 text-xs font-bold text-steel">{formatDateTime(event.createdAt)}</p>
                    </div>
                    <Badge>{event.status}</Badge>
                  </div>
                  {event.orderId ? <p className="mt-2 font-mono text-xs font-bold text-steel">{event.orderId}</p> : null}
                </div>
              ))}
              {customer.claimEvents.length === 0 ? <EmptyState text="No claim events recorded." /> : null}
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

async function loadCustomer(id: string) {
  try {
    return { ok: true as const, customer: await loadAdminCustomerDetailData(id) };
  } catch (error) {
    if (error instanceof AdminCustomerDetailInvalidIdError) notFound();
    if (error instanceof AdminCustomerDetailNotFoundError) notFound();
    if (error instanceof AdminUnauthenticatedError) {
      return { ok: false as const, title: "Admin sign-in required", message: "Please sign in with an admin account before opening customer details." };
    }
    if (error instanceof AdminForbiddenError) {
      return { ok: false as const, title: "Admin access required", message: "This account is not allowed to view admin customer details." };
    }
    if (error instanceof AdminConfigurationError) {
      return { ok: false as const, title: "Admin configuration missing", message: "Admin access is not configured for this environment." };
    }
    if (error instanceof AdminInfrastructureError) {
      return { ok: false as const, title: "Admin service unavailable", message: "Admin access could not be verified. Please try again shortly." };
    }
    throw error;
  }
}

function AdminCustomerError({ title, message }: { title: string; message: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-black/10 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3 text-signal">
          <ShieldAlert className="h-6 w-6" />
          <p className="text-sm font-black uppercase tracking-[0.18em]">Admin</p>
        </div>
        <h1 className="mt-4 text-3xl font-black">{title}</h1>
        <p className="mt-3 leading-7 text-steel">{message}</p>
        <Link href="/account" className="mt-6 inline-flex h-11 items-center justify-center rounded bg-ink px-5 font-black text-white">
          Go to account
        </Link>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const Icon = title.includes("Vehicle") ? CarFront : title.includes("Address") ? MapPin : title.includes("Order") ? ReceiptText : title.includes("Customer") ? UserRound : Mail;
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-signal" />
        <h2 className="text-xl font-black">{title}</h2>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-steel">{label}</p>
      <p className="mt-3 text-2xl font-black">{value}</p>
    </div>
  );
}

function ReadOnlyRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-2 border-b border-black/10 py-3 last:border-b-0 sm:grid-cols-[150px_1fr]">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</span>
      <span className={`break-all text-sm font-bold ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function SmallFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className={`mt-1 break-all font-bold ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex w-fit rounded bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-steel">{children}</span>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-black/10 bg-white p-8 text-center font-bold text-steel">{text}</div>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-NZ");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-NZ");
}

function formatAddress(address: AdminCustomerDetail["addresses"][number]) {
  return [
    address.company,
    address.line1,
    address.line2,
    address.suburb,
    address.city,
    address.region,
    address.postcode,
    address.country
  ]
    .filter(Boolean)
    .join(", ");
}
