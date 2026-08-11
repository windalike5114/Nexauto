import type { AdminOrderDetailCustomer } from "@/lib/application/admin/admin-order-detail.types";

export function AdminOrderCustomerCard({ customer }: { customer: AdminOrderDetailCustomer }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Customer and address</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Info title="Customer">
          <p className="font-black">{customer.name ?? "No name"}</p>
          <p className="mt-1 break-all text-sm font-bold text-steel">{customer.email ?? "No email"}</p>
          <p className="mt-1 text-sm font-bold text-steel">{customer.phone ?? "No phone"}</p>
          <p className="mt-3 text-xs font-black uppercase tracking-[0.12em] text-steel">{customer.accountType === "account" ? "Account order" : "Guest order"}</p>
        </Info>
        <Info title="Shipping snapshot">
          <Address value={customer.shippingAddress} />
        </Info>
        <Info title="Billing snapshot">
          <Address value={customer.billingAddress} />
        </Info>
      </div>
    </section>
  );
}

function Info({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-black/10 bg-zinc-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{title}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Address({ value }: { value: Record<string, unknown> }) {
  const lines = [
    value.name,
    value.line1,
    value.line2,
    value.city,
    value.region,
    value.postalCode ?? value.postal_code,
    value.country
  ]
    .filter(Boolean)
    .map(String);

  return <p className="whitespace-pre-wrap text-sm font-bold leading-6 text-steel">{lines.join("\n") || "Not provided"}</p>;
}
