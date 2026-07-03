"use client";

import { useMemo, useState } from "react";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import {
  findMatchingVariant,
  formatAttributeName,
  formatMoney,
  getDefaultSelection
} from "@/lib/catalog";
import type { Product, ProductAttributes, ProductVariant, SelectedAttributes } from "@/lib/types";
import { useCart } from "./cart-provider";

export function ProductConfigurator({
  product,
  attributes,
  variants
}: {
  product: Product;
  attributes: ProductAttributes;
  variants: ProductVariant[];
}) {
  const [selected, setSelected] = useState<SelectedAttributes>(() => getDefaultSelection(attributes));
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();

  const variant = useMemo(() => findMatchingVariant(variants, selected), [selected, variants]);

  function handleAdd() {
    if (!variant) return;

    addItem({
      productId: product.id,
      variantId: variant.id,
      sku: variant.sku,
      name: product.name,
      category: product.category,
      qty,
      price: variant.price,
      attributes: variant.attributes
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  return (
    <div className="space-y-6 rounded-lg border border-black/10 bg-white p-5 shadow-panel">
      {Object.entries(attributes).map(([key, values]) => (
        <div key={key}>
          <label className="text-sm font-black text-ink">{formatAttributeName(key)}</label>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {values.map((value) => {
              const active = String(selected[key]) === String(value);
              return (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setSelected((current) => ({ ...current, [key]: value }))}
                  className={`min-h-11 rounded border px-3 text-sm font-bold transition ${
                    active
                      ? "border-ink bg-ink text-white"
                      : "border-black/10 bg-white text-steel hover:border-ink hover:text-ink"
                  }`}
                >
                  {String(value)}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="rounded bg-zinc-50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-steel">Selected SKU</p>
            <p className="mt-1 font-mono text-sm font-bold">{variant?.sku ?? "No matching SKU"}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black">{formatMoney(variant?.price ?? product.price)}</p>
            <p className="text-xs font-bold text-steel">{variant ? `${variant.stock} in stock` : "Unavailable"}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="grid h-12 grid-cols-3 rounded border border-black/10 bg-white sm:w-36">
          <button type="button" aria-label="Decrease quantity" onClick={() => setQty((value) => Math.max(1, value - 1))}>
            <Minus className="mx-auto h-4 w-4" />
          </button>
          <div className="grid place-items-center font-black">{qty}</div>
          <button type="button" aria-label="Increase quantity" onClick={() => setQty((value) => value + 1)}>
            <Plus className="mx-auto h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          disabled={!variant}
          onClick={handleAdd}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded bg-signal px-5 font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {added ? <Check className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
          {added ? "Added" : "Add to cart"}
        </button>
      </div>
    </div>
  );
}
