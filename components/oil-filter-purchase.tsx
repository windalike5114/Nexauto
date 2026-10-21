"use client";

import { useState } from "react";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import type { OilFilterDetail } from "@/lib/oil-filter";

export function OilFilterPurchase({ detail }: { detail: OilFilterDetail }) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();
  const available = detail.product.purchasable && detail.variant.stock > 0;

  function addToCart() {
    if (!available) return;
    addItem({
      productId: "oil_filter",
      variantId: detail.partNumber,
      sku: detail.variant.sku,
      name: detail.title,
      category: detail.product.category,
      qty: quantity,
      price: detail.variant.price,
      imageUrl: detail.imageUrl,
      attributes: detail.variant.attributes
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-panel">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="grid h-12 grid-cols-3 rounded border border-black/10 bg-white sm:w-36">
          <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>
            <Minus className="mx-auto h-4 w-4" />
          </button>
          <div className="grid place-items-center font-black" aria-live="polite">{quantity}</div>
          <button type="button" aria-label="Increase quantity" onClick={() => setQuantity((value) => value + 1)}>
            <Plus className="mx-auto h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          disabled={!available}
          onClick={addToCart}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded bg-signal px-5 font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600"
        >
          {added ? <Check className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
          {added ? "Added" : available ? "Add to Cart" : detail.product.checkoutEnabled ? "Out of stock" : "Price to be set"}
        </button>
      </div>
      {!detail.product.checkoutEnabled ? (
        <p className="mt-3 text-xs font-bold leading-5 text-steel">
          This catalogue item cannot be purchased until price, stock and fitment data have been approved.
        </p>
      ) : null}
    </section>
  );
}
