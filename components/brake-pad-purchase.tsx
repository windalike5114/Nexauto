"use client";

import { useState } from "react";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import { ProductVehicleFitment } from '@/components/product-vehicle-fitment';
import { useVehicleContext } from '@/components/vehicle-context-provider';
import { sameVehicleContext } from '@/lib/vehicle-context';
import { useCart } from "@/components/cart-provider";
import type { BrakePadDetail } from "@/lib/brake-pad";
import type { VehicleContext } from '@/lib/vehicle-context';
import { vehicleCartAttributes } from '@/lib/vehicle-cart';

type VehicleFitmentStatus = "not-selected" | "fits" | "conditional" | "not-listed" | "unavailable";

export function BrakePadPurchase({
  detail,
  vehicleFitmentStatus,
  vehicle
}: {
  detail: BrakePadDetail;
  vehicleFitmentStatus: VehicleFitmentStatus;
  vehicleLabel: string;
  vehicle?: VehicleContext | null;
}) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();
  const { vehicle: currentVehicle } = useVehicleContext();
  const available = detail.product.purchasable && detail.product.checkoutEnabled;
  function addToCart() {
    if (!available) return;
    addItem({
      productId: "brake_pad",
      variantId: detail.partNumber,
      sku: detail.variant.sku,
      name: detail.title,
      category: detail.product.category,
      qty: quantity,
      price: detail.variant.price,
      imageUrl: detail.imageUrl,
      attributes: { ...detail.variant.attributes, ...vehicleCartAttributes(currentVehicle,sameVehicleContext(currentVehicle,vehicle??null)?vehicleFitmentStatus:'unavailable') }
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
          {added ? "Added" : available ? "Add to Cart" : "Ordering unavailable"}
        </button>
      </div>
      <div className="mt-3"><ProductVehicleFitment checkedVehicle={vehicle??null} status={vehicleFitmentStatus}/></div>
    </section>
  );
}
