"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
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
  const [qty, setQty] = useState(1);
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
      qty,
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
        qty,
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

  const total = wiperSet.price * qty + (rearAddon && includeRear ? rearAddon.price * qty : 0);

  return (
    <div className="rounded-lg border border-black/10 bg-white p-5 shadow-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Front pair kit</p>
          <p className="mt-1 font-mono text-sm font-black">{wiperSet.sku}</p>
        </div>
        <p className="text-2xl font-black">{formatMoney(wiperSet.price)}</p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <SpecTile label="Driver side" value={`${wiperSet.driverLengthIn}"`} />
        <SpecTile label="Passenger side" value={`${wiperSet.passengerLengthIn}"`} />
      </div>

      {vehicle ? (
        <div className="mt-4 rounded border border-black/10 bg-zinc-50 p-3 text-sm font-bold text-steel">
          Vehicle checked: <span className="text-ink">{vehicle}</span>
        </div>
      ) : null}

      {rearAddon ? (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded border border-black/10 bg-zinc-50 p-3">
          <input
            type="checkbox"
            checked={includeRear}
            onChange={(event) => setIncludeRear(event.target.checked)}
            className="mt-1 h-4 w-4 accent-red-600"
          />
          <span className="flex-1">
            <span className="block text-sm font-black">Add rear blade</span>
            <span className="mt-1 block text-sm font-bold text-steel">
              {rearAddon.name} · {formatMoney(rearAddon.price)}
            </span>
          </span>
        </label>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
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
          onClick={handleAdd}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded bg-signal px-5 font-black text-white hover:bg-red-700"
        >
          {added ? <Check className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
          {added ? "Added" : `Add to cart · ${formatMoney(total)}`}
        </button>
      </div>

      <Link href="/cart" className="mt-3 inline-flex h-11 w-full items-center justify-center rounded border border-black/10 text-sm font-black text-ink hover:border-ink">
        View cart
      </Link>
    </div>
  );
}

function SpecTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black/10 bg-zinc-50 p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
