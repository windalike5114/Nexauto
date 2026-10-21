"use client";

import { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, CircleHelp, Minus, Plus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useCart } from "@/components/cart-provider";
import type { BrakePadDetail } from "@/lib/brake-pad";

type VehicleFitmentStatus = "not-selected" | "fits" | "not-listed" | "unavailable";

export function BrakePadPurchase({
  detail,
  vehicleFitmentStatus,
  vehicleLabel
}: {
  detail: BrakePadDetail;
  vehicleFitmentStatus: VehicleFitmentStatus;
  vehicleLabel: string;
}) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();
  const available = detail.product.purchasable && detail.product.checkoutEnabled;
  const fitmentVisual = vehicleFitmentStatus === "fits"
    ? {
        icon: <CheckCircle2 className="h-4 w-4" />,
        container: "border-emerald-700/20 bg-emerald-50 text-emerald-900",
        message: "Fits your selected vehicle"
      }
    : vehicleFitmentStatus === "not-listed"
      ? {
          icon: <AlertTriangle className="h-4 w-4" />,
          container: "border-red-700/20 bg-red-50 text-red-900",
          message: "Not listed for your selected vehicle"
        }
      : vehicleFitmentStatus === "unavailable"
        ? {
            icon: <AlertTriangle className="h-4 w-4" />,
            container: "border-amber-700/20 bg-amber-50 text-amber-950",
          message: "Vehicle fitment check is not available yet"
          }
        : {
            icon: <CircleHelp className="h-4 w-4" />,
            container: "border-black/10 bg-zinc-50 text-steel",
            message: "This product is vehicle specific"
          };

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
          {added ? "Added" : available ? "Add to Cart" : "Ordering unavailable"}
        </button>
      </div>
      <div className={`mt-3 flex items-start gap-2 rounded border px-3 py-2 text-xs font-bold leading-5 ${fitmentVisual.container}`}>
        <span className="mt-0.5 shrink-0" aria-hidden="true">{fitmentVisual.icon}</span>
        <p>
          <span className="font-black">{fitmentVisual.message}</span>
          {vehicleLabel ? ` · ${vehicleLabel}. ` : ". "}
          <Link href="/parts#change-vehicle" className="font-black text-signal hover:underline">
            {vehicleFitmentStatus === "not-selected" ? "Select your vehicle" : "Change vehicle"}
          </Link>
          {vehicleFitmentStatus === "not-selected" ? " to check fitment." : null}
        </p>
      </div>
    </section>
  );
}
