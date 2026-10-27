"use client";

import { useState } from "react";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import type { CartItem } from "@/lib/types";
import { useVehicleContext } from '@/components/vehicle-context-provider';
import { vehicleCartAttributes } from '@/lib/vehicle-cart';

export function BulbPurchase({ item, orderingEnabled }: { item: CartItem; orderingEnabled: boolean }) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();
  const { vehicle } = useVehicleContext();

  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-panel">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="grid h-12 grid-cols-3 rounded border border-black/10 bg-white sm:w-36">
          <button type="button" aria-label="Decrease quantity" disabled={quantity === 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))}>
            <Minus className="mx-auto h-4 w-4" />
          </button>
          <div className="grid place-items-center font-black" aria-live="polite">{quantity}</div>
          <button type="button" aria-label="Increase quantity" disabled={quantity >= 99} onClick={() => setQuantity((value) => Math.min(99, value + 1))}>
            <Plus className="mx-auto h-4 w-4" />
          </button>
        </div>
        <button type="button" disabled={!orderingEnabled}
          onClick={() => { addItem({ ...item, qty: quantity, attributes:{...item.attributes,...vehicleCartAttributes(vehicle,'not-listed')} }); setAdded(true); }}
          className="inline-flex h-12 items-center justify-center gap-2 rounded bg-signal px-5 font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 sm:flex-1">
          {added ? <Check className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
          {orderingEnabled ? "Add to Cart" : "Currently unavailable"}
        </button>
      </div>
      <p role="status" className={added ? "mt-3 text-xs font-bold text-steel" : "sr-only"}>{added ? "Added to your cart." : ""}</p>
    </section>
  );
}
