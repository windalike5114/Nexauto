"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import { formatAttributeName, formatMoney } from "@/lib/catalog";

export default function CartPage() {
  const { items, subtotal, updateQty, removeItem } = useCart();
  const selectedVehicle = getSelectedVehicle(items);

  async function checkout() {
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items })
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

            {items.map((item) => (
              <article key={item.sku} className="rounded-lg border border-black/10 bg-white p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-lg font-black">{item.name}</p>
                    <p className="mt-1 font-mono text-sm font-bold text-steel">{item.sku}</p>
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
                      onChange={(event) => updateQty(item.sku, Number(event.target.value))}
                      className="h-11 w-20 rounded border border-black/10 px-3 font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(item.sku)}
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
            ))}
          </div>
          <aside className="h-fit rounded-lg border border-black/10 bg-white p-5 shadow-panel">
            <div className="flex justify-between text-lg font-black">
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-steel">Shipping and tax are collected in Stripe Checkout.</p>
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

function isCustomerVisibleAttribute(key: string) {
  return !["vehicle", "vehicle_application_id", "vehicle_make", "vehicle_model", "vehicle_year"].includes(key);
}
