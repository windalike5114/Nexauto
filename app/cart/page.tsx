"use client";

import Link from "next/link";
import { Gift, Trash2 } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { formatAttributeName, formatMoney } from "@/lib/catalog";
import { calculateCartPricing, calculateOrderTotals } from "@/lib/pricing";

export default function CartPage() {
  const {
    items,
    updateQty,
    removeItem,
    couponCode,
    couponDiscount,
    couponLabel,
    couponError,
    couponDraft,
    validatingCoupon,
    welcomeRewardStatus,
    welcomeRewardDiscount,
    applyWelcomeReward,
    removeWelcomeReward,
    setCouponDraft,
    applyCoupon,
    clearCoupon
  } = useCart();
  const selectedVehicle = getSelectedVehicle(items);
  const pricing = calculateCartPricing(items);
  const totals = calculateOrderTotals(pricing, couponDiscount + welcomeRewardDiscount);

  async function checkout() {
    if (couponDraft.trim() && !couponCode) {
      await applyCoupon();
      return;
    }

    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        couponCode: couponCode || undefined,
        welcomeRewardApplied: welcomeRewardStatus === "applied"
      })
    });
    const data = (await response.json()) as { url?: string; error?: string };
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    alert(data.error ?? "Checkout is not configured yet.");
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Cart</p>
        <h1 className="mt-2 text-4xl font-black">Your order</h1>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-black/10 bg-white p-8 text-center">
          <p className="text-lg font-bold text-steel">Your cart is empty.</p>
          <Link href="/shop" className="mt-5 inline-flex rounded bg-ink px-5 py-3 font-black text-white">
            Browse parts
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            {selectedVehicle ? (
              <section className="rounded-lg border border-black/10 bg-zinc-50 p-5">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">Selected vehicle</p>
                <p className="mt-2 text-2xl font-black text-ink">{selectedVehicle}</p>
                <p className="mt-2 text-sm font-bold text-steel">
                  This vehicle will be included with the order for fitment and connector fulfillment.
                </p>
              </section>
            ) : null}

            {items.map((item) => {
              const lineId = getCartLineId(item);
              return (
              <article key={lineId} className="rounded-lg border border-black/10 bg-white p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-lg font-black">{item.name}</p>
                    <p className="mt-1 font-mono text-sm font-bold text-steel">{item.sku}</p>
                    {getVehicleLabel(item) ? <p className="mt-2 text-sm font-black text-ink">For: {getVehicleLabel(item)}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(item.attributes).filter(([key]) => isCustomerVisibleAttribute(key)).map(([key, value]) => (
                        <span key={key} className="rounded bg-zinc-100 px-3 py-1 text-xs font-bold text-steel">
                          {formatAttributeName(key)}: {String(value)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      aria-label={`Quantity for ${item.sku}`}
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(event) => updateQty(lineId, Number(event.target.value))}
                      className="h-11 w-20 rounded border border-black/10 px-3 font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(lineId)}
                      className="grid h-11 w-11 place-items-center rounded border border-black/10 text-steel hover:text-signal"
                      aria-label={`Remove ${item.sku}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex justify-between border-t border-black/10 pt-4 font-black">
                  <span>{formatMoney(item.price)} each</span>
                  <span>{formatMoney(item.price * item.qty)}</span>
                </div>
              </article>
              );
            })}
            <section className="rounded-lg border border-black/10 bg-[#F8FAFC] p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">Wiper fitment</p>
              <h2 className="mt-2 text-2xl font-black text-ink">Find wipers for another vehicle</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-steel">
                Add another vehicle's matched front pair without losing the current cart.
              </p>
              <div className="mt-4">
                <WiperFitmentFinder
                  compact
                  directToProduct
                  title="Find another front pair"
                  description="Select make, model, and year to continue shopping for another vehicle."
                  directButtonLabel="Find Wipers"
                />
              </div>
            </section>
          </div>
          <aside className="h-fit rounded-lg border border-black/10 bg-white p-5 shadow-panel">
            {pricing.bundleProgressMessage ? (
              <div className="mb-4 rounded-lg border border-signal/20 bg-red-50 p-3 text-sm font-black text-signal">
                {pricing.bundleProgressMessage}
              </div>
            ) : null}
            <div className="mt-5 rounded-lg border border-black/10 bg-zinc-50 p-4">
              <label htmlFor="coupon" className="text-xs font-black uppercase tracking-[0.14em] text-steel">
                Coupon code
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="coupon"
                  value={couponDraft}
                  onChange={(event) => setCouponDraft(event.target.value)}
                  placeholder="Enter code"
                  className="h-11 min-w-0 flex-1 rounded border border-black/10 bg-white px-3 text-sm font-bold text-ink outline-none focus:border-ink"
                />
                <button
                  type="button"
                  onClick={applyCoupon}
                  disabled={validatingCoupon}
                  className="h-11 rounded bg-ink px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-black disabled:bg-zinc-300"
                >
                  {validatingCoupon ? "Checking" : "Apply"}
                </button>
              </div>
              {couponCode ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                  <span>
                    Applied: {couponCode} ({couponLabel}, {formatMoney(couponDiscount)})
                  </span>
                  <button
                    type="button"
                    onClick={clearCoupon}
                    className="text-xs font-black uppercase tracking-[0.12em] text-emerald-900 hover:text-ink"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
              {couponError ? <p className="mt-3 text-xs font-bold text-signal">{couponError}</p> : null}
              <p className="mt-3 text-xs font-bold leading-5 text-steel">
                Coupon codes are checked before checkout and revalidated securely at payment.
              </p>
            </div>
            {welcomeRewardStatus === "available" || welcomeRewardStatus === "applied" ? (
              <div className="mt-4 rounded-lg border border-red-100 bg-red-50 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-signal text-white">
                    <Gift className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-black text-ink">
                      {welcomeRewardStatus === "applied" ? "Welcome Reward Applied" : "Welcome Reward"}
                    </p>
                    <p className="mt-1 text-xs font-bold leading-5 text-steel">
                      {welcomeRewardStatus === "applied" ? `-${formatMoney(welcomeRewardDiscount)} applied to this cart.` : "NZ$10 registration reward available."}
                    </p>
                    <button
                      type="button"
                      onClick={welcomeRewardStatus === "applied" ? removeWelcomeReward : applyWelcomeReward}
                      className="mt-3 h-9 rounded bg-ink px-3 text-xs font-black text-white hover:bg-black"
                    >
                      {welcomeRewardStatus === "applied" ? "Remove" : "Apply"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="mt-5 space-y-2 text-sm font-bold text-steel">
              <SummaryRow label="Subtotal" value={formatMoney(totals.subtotal)} />
              {pricing.bundleDiscount > 0 ? <SummaryRow label={pricing.bundleLabel || "Bundle discount"} value={`-${formatMoney(pricing.bundleDiscount)}`} highlight /> : null}
              {welcomeRewardDiscount > 0 ? <SummaryRow label="Welcome Reward" value={`-${formatMoney(welcomeRewardDiscount)}`} highlight /> : null}
              {couponDiscount > 0 ? <SummaryRow label="Coupon" value={`-${formatMoney(couponDiscount)}`} highlight /> : null}
              <SummaryRow label="Shipping" value="FREE" highlight />
              <SummaryRow label="GST inc." value={formatMoney(totals.gstIncluded)} />
              <SummaryRow label="Order total" value={formatMoney(totals.orderTotal)} />
              {totals.discount > 0 ? <SummaryRow label="Discount" value={`-${formatMoney(totals.discount)}`} highlight /> : null}
              <SummaryRow label="Grand total" value={`NZD ${formatMoney(totals.grandTotal)}`} strong />
            </div>
            <p className="mt-3 text-sm leading-6 text-steel">GST is included where applicable. Delivery address is confirmed in Stripe Checkout.</p>
            <button
              type="button"
              onClick={checkout}
              className="mt-5 h-12 w-full rounded bg-signal px-5 font-black text-white hover:bg-red-700"
            >
              Checkout
            </button>
          </aside>
        </div>
      )}
    </main>
  );
}

function getCartLineId(item: ReturnType<typeof useCart>["items"][number]) {
  return item.lineId ?? [item.productId, item.variantId, item.sku, item.attributes.vehicle_application_id ?? "", item.attributes.vehicle ?? ""].join("|");
}

function getSelectedVehicle(items: ReturnType<typeof useCart>["items"]) {
  for (const item of items) {
    const vehicle = item.attributes.vehicle;
    if (typeof vehicle === "string" && vehicle.trim()) return vehicle;
  }

  const make = items.find((item) => typeof item.attributes.vehicle_make === "string")?.attributes.vehicle_make;
  const model = items.find((item) => typeof item.attributes.vehicle_model === "string")?.attributes.vehicle_model;
  const year = items.find((item) => typeof item.attributes.vehicle_year !== "undefined")?.attributes.vehicle_year;
  const vehicle = [make, model, year].filter(Boolean).join(" ");
  return vehicle || "";
}

function SummaryRow({ label, value, highlight = false, strong = false }: { label: string; value: string; highlight?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${highlight ? "text-signal" : ""} ${strong ? "border-t border-black/10 pt-3 text-lg font-black text-ink" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function isCustomerVisibleAttribute(key: string) {
  return !["vehicle", "vehicle_application_id", "vehicle_make", "vehicle_model", "vehicle_year"].includes(key);
}

function getVehicleLabel(item: ReturnType<typeof useCart>["items"][number]) {
  const vehicle = item.attributes.vehicle;
  if (typeof vehicle === "string" && vehicle.trim()) return vehicle;

  return [item.attributes.vehicle_year, item.attributes.vehicle_make, item.attributes.vehicle_model].filter(Boolean).join(" ");
}
