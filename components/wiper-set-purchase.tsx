"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ShoppingBag } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import type { WiperRearAddon, WiperSet } from "@/lib/types";
import { useCart } from "./cart-provider";

export function WiperSetPurchase({
  wiperSet,
  rearAddon,
  vehicle,
  vehicleContext
}: {
  wiperSet: WiperSet;
  rearAddon: WiperRearAddon | null;
  vehicle: string;
  vehicleContext: {
    applicationId: string;
    make: string;
    model: string;
    year: number;
  } | null;
}) {
  const [includeRear, setIncludeRear] = useState(Boolean(rearAddon));
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();

  function handleAdd() {
    addItem({
      productId: "wiper_set",
      variantId: wiperSet.id,
      sku: wiperSet.sku,
      name: wiperSet.name,
      category: "wiper",
      qty: 1,
      price: wiperSet.price,
      attributes: {
        driver_length: `${wiperSet.driverLengthIn}"`,
        passenger_length: `${wiperSet.passengerLengthIn}"`,
        ...(vehicle ? { vehicle } : {}),
        ...(vehicleContext
          ? {
              vehicle_application_id: vehicleContext.applicationId,
              vehicle_make: vehicleContext.make,
              vehicle_model: vehicleContext.model,
              vehicle_year: vehicleContext.year
            }
          : {})
      }
    });

    if (rearAddon && includeRear) {
      addItem({
        productId: "wiper_rear_addon",
        variantId: rearAddon.id,
        sku: `WPR${rearAddon.rearLengthIn}`,
        name: rearAddon.name,
        category: "wiper",
        qty: 1,
        price: rearAddon.price,
        attributes: {
          rear_length: `${rearAddon.rearLengthIn}"`,
          ...(vehicle ? { vehicle } : {}),
          ...(vehicleContext
            ? {
                vehicle_application_id: vehicleContext.applicationId,
                vehicle_make: vehicleContext.make,
                vehicle_model: vehicleContext.model,
                vehicle_year: vehicleContext.year
              }
            : {})
        }
      });
    }

    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  const total = wiperSet.price + (rearAddon && includeRear ? rearAddon.price : 0);
  const addLabel =
    rearAddon && includeRear
      ? `Add Front + Rear - ${formatMoney(total)}`
      : `Add Front Pair - ${formatMoney(total)}`;

  return (
    <div className="rounded-lg border border-black/10 bg-white p-5 shadow-panel">
      {rearAddon ? (
        <label className="flex cursor-pointer items-start gap-3 rounded border border-black/10 bg-zinc-50 p-3">
          <input
            type="checkbox"
            checked={includeRear}
            onChange={(event) => setIncludeRear(event.target.checked)}
            className="mt-1 h-4 w-4 accent-red-600"
          />
          <span className="flex-1">
            <span className="block text-sm font-black">Add rear blade</span>
            <span className="mt-1 block text-sm font-bold text-steel">
              {rearAddon.rearLengthIn}" / {toMillimetres(rearAddon.rearLengthIn)} mm - {formatMoney(rearAddon.price)}
            </span>
          </span>
        </label>
      ) : null}

      <div className={rearAddon ? "mt-5" : ""}>
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-signal px-5 font-black text-white hover:bg-red-700"
        >
          {added ? <Check className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
          {added ? "Added" : addLabel}
        </button>
      </div>

      <Link href="/cart" className="mt-3 inline-flex h-11 w-full items-center justify-center rounded border border-black/10 text-sm font-black text-ink hover:border-ink">
        View cart
      </Link>
    </div>
  );
}

function toMillimetres(lengthIn: number) {
  return Math.round(lengthIn * 25.4);
}
