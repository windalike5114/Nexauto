"use client";

import { ShoppingBag } from "lucide-react";
import { useCart } from "./cart-provider";

export function TestCheckoutCard() {
  const { addItem } = useCart();

  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-dashed border-black/20 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel sm:rounded-[14px]">
      <div className="grid aspect-square place-items-center bg-zinc-50 p-2.5 text-center sm:aspect-[1/0.82] sm:p-5">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.1em] text-signal sm:text-xs sm:tracking-[0.16em]">Test product</p>
          <p className="mt-1 text-3xl font-black sm:mt-2 sm:text-4xl">$1</p>
        </div>
      </div>
      <div className="space-y-2 p-2.5 sm:space-y-3 sm:p-4">
        <div>
          <h2 className="line-clamp-2 min-h-8 text-[13px] font-black leading-4 text-ink sm:min-h-0 sm:text-base sm:leading-snug">Checkout Test Product</h2>
          <p className="mt-1 line-clamp-2 text-[11px] font-bold leading-4 text-steel sm:mt-2 sm:text-sm sm:leading-5">Use this item to test Stripe, order creation, emails, and admin order flow.</p>
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-base font-black text-ink sm:text-lg">NZ$1.00</span>
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
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded bg-ink px-2 text-xs font-black text-white hover:bg-black sm:h-[42px] sm:gap-2 sm:px-3 sm:text-sm"
        >
          <ShoppingBag className="h-4 w-4" />
          Add Test Product
        </button>
      </div>
    </article>
  );
}
