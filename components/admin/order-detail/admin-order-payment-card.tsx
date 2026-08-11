import type { AdminOrderDetailPayment } from "@/lib/application/admin/admin-order-detail.types";
import { formatMoney } from "@/lib/catalog";

export function AdminOrderPaymentCard({ payment }: { payment: AdminOrderDetailPayment }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Payment</h2>
      <dl className="mt-4 grid gap-3">
        <Row label="Payment status" value={payment.statusLabel} />
        <Row label="Stored total" value={`${formatMoney(payment.storedTotal)} ${payment.currency.toUpperCase()}`} />
        {payment.stripeInvoiceUrl ? (
          <a href={payment.stripeInvoiceUrl} className="inline-flex w-fit rounded bg-zinc-100 px-3 py-2 text-xs font-black text-ink hover:bg-zinc-200">
            View Stripe invoice
          </a>
        ) : null}
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</dt>
      <dd className="mt-1 break-all text-sm font-bold">{value}</dd>
    </div>
  );
}
