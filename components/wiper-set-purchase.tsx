"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { getWiperBundleSavings, getWiperPairLineTotal, wiperPairPricing } from "@/lib/pricing";
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

  const frontPairTotal = getWiperPairLineTotal(qty, wiperSet.price);
  const total = frontPairTotal + (rearAddon && includeRear ? rearAddon.price * qty : 0);
  const savings = getWiperBundleSavings(qty, wiperSet.price);

  return (
    <div className="rounded-lg border border-black/10 bg-white p-5 shadow-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Front pair kit</p>
          <p className="mt-1 font-mono text-sm font-black">{wiperSet.sku}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-black text-steel line-through">{formatMoney(wiperSet.compareAtPrice ?? wiperPairPricing.compareAtPrice)}</p>
          <p className="text-2xl font-black">{formatMoney(wiperSet.price)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm font-black text-ink sm:grid-cols-3">
        <span className="rounded bg-zinc-50 px-3 py-2">
          <span className="text-steel line-through">$8 Shipping</span> Waived
        </span>
        <span className="rounded bg-zinc-50 px-3 py-2">12-Month Warranty</span>
        <span className="rounded bg-zinc-50 px-3 py-2">Auckland Dispatch</span>
      </div>

      <div className="mt-4 rounded-lg border border-signal/20 bg-red-50 p-3">
        <p className="text-sm font-black text-ink">Bundle pricing</p>
        <div className="mt-2 grid gap-2 text-sm font-bold text-steel sm:grid-cols-3">
          <button type="button" onClick={() => setQty(1)} className={`rounded border px-3 py-2 text-left ${qty === 1 ? "border-signal bg-white text-ink" : "border-black/10 bg-white"}`}>
            1 Pair <span className="block font-black">{formatMoney(wiperSet.price)}</span>
          </button>
          <button type="button" onClick={() => setQty(2)} className={`rounded border px-3 py-2 text-left ${qty === 2 ? "border-signal bg-white text-ink" : "border-black/10 bg-white"}`}>
            2 Pairs <span className="block font-black">{formatMoney(wiperPairPricing.bundleTotals[2])}</span>
          </button>
          <button type="button" onClick={() => setQty(3)} className={`rounded border px-3 py-2 text-left ${qty === 3 ? "border-signal bg-white text-ink" : "border-black/10 bg-white"}`}>
            3 Pairs <span className="block font-black">{formatMoney(wiperPairPricing.bundleTotals[3])}</span>
          </button>
        </div>
        {savings > 0 ? <p className="mt-2 text-sm font-black text-signal">You save {formatMoney(savings)}</p> : null}
        <p className="mt-2 text-xs font-bold text-steel">Member price {formatMoney(wiperPairPricing.memberPrice)} is reserved for the next account pricing phase.</p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <SpecTile label="Driver side" lengthIn={wiperSet.driverLengthIn} />
        <SpecTile label="Passenger side" lengthIn={wiperSet.passengerLengthIn} />
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
              {rearAddon.name} ({toMillimetres(rearAddon.rearLengthIn)} mm) - {formatMoney(rearAddon.price)}
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
          {added ? "Added" : `Add to cart - ${formatMoney(total)}`}
        </button>
      </div>

      <Link href="/cart" className="mt-3 inline-flex h-11 w-full items-center justify-center rounded border border-black/10 text-sm font-black text-ink hover:border-ink">
        View cart
      </Link>
    </div>
  );
}

function SpecTile({ label, lengthIn }: { label: string; lengthIn: number }) {
  return (
    <div className="rounded border border-black/10 bg-zinc-50 p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className="mt-1 text-2xl font-black">{lengthIn}"</p>
      <p className="mt-1 text-xs font-black text-steel">{toMillimetres(lengthIn)} mm</p>
    </div>
  );
}

function toMillimetres(lengthIn: number) {
  return Math.round(lengthIn * 25.4);
}
