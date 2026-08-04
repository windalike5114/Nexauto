import type { AdminOrderDetailPricing } from "@/lib/application/admin/admin-order-detail.types";
import { formatMoney } from "@/lib/catalog";

export function AdminOrderPricingCard({ pricing }: { pricing: AdminOrderDetailPricing }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-black">Pricing snapshot</h2>
          <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-steel">Source: {pricing.source.replace(/_/g, " ")}</p>
        </div>
        {pricing.invariant.matches === false ? <span className="rounded bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-amber-800">Mismatch</span> : null}
      </div>
      <dl className="mt-4 grid gap-2 text-sm font-bold">
        <MoneyRow label="Product subtotal" value={pricing.productSubtotal} />
        <MoneyRow label="Bundle discount" value={-pricing.bundleDiscount} />
        <MoneyRow label="Welcome reward" value={-pricing.welcomeRewardDiscount} />
        <MoneyRow label="Coupon discount" value={-pricing.couponDiscount} />
        <MoneyRow label="Other discounts" value={-pricing.otherDiscount} />
        <MoneyRow label="Shipping" value={pricing.shipping} />
        <MoneyRow label="GST inc." value={pricing.gstIncluded} />
        <div className="mt-2 flex items-center justify-between border-t border-black/10 pt-3 text-base">
          <dt className="font-black">Grand total</dt>
          <dd className="font-black">{formatMoney(pricing.grandTotal)}</dd>
        </div>
      </dl>
      {pricing.invariant.expectedGrandTotal !== null ? (
        <p className="mt-4 text-xs font-bold text-steel">
          Check: subtotal minus discounts plus shipping = {formatMoney(pricing.invariant.expectedGrandTotal)}
        </p>
      ) : null}
    </section>
  );
}

function MoneyRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-steel">{label}</dt>
      <dd className="text-right">{value === null ? "Unavailable" : formatMoney(value)}</dd>
    </div>
  );
}
