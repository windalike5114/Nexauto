"use client";

import { ShoppingBag } from "lucide-react";
import { useCart } from "./cart-provider";

export function TestCheckoutCard() {
  const { addItem } = useCart();

  return (
    <article className="overflow-hidden rounded-[14px] border border-dashed border-black/20 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel">
      <div className="grid aspect-[1/0.82] place-items-center bg-zinc-50 p-5 text-center">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">Test product</p>
          <p className="mt-2 text-4xl font-black">$1</p>
        </div>
      </div>
      <div className="space-y-3 p-3 sm:p-4">
        <div>
          <h2 className="text-sm font-black leading-snug text-ink sm:text-base">Checkout Test Product</h2>
          <p className="mt-2 text-sm font-bold leading-5 text-steel">Use this item to test Stripe, order creation, emails, and admin order flow.</p>
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-lg font-black text-ink">NZ$1.00</span>
        </div>
        <button
          type="button"
          onClick={() =>
            addItem({
              productId: "test_product",
              variantId: "test-001",
              sku: "TEST-001",
              name: "NexAutoParts Checkout Test Product",
              category: "test",
              qty: 1,
              price: 1,
              bundleEligible: false,
              attributes: {
                test_product: "true"
              }
            })
          }
          className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded bg-ink px-3 text-sm font-black text-white hover:bg-black"
        >
          <ShoppingBag className="h-4 w-4" />
          Add Test Product
        </button>
      </div>
    </article>
  );
}
