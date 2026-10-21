"use client";

import Link from "next/link";
import { CarFront, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { buildVehiclePartsHref, VehiclePartsFinder } from "@/components/vehicle-parts-finder";
import {
  readVehicleContextFromBrowser,
  vehicleContextChangedEvent,
  vehicleContextStorageKey,
  type VehicleContext
} from "@/lib/vehicle-context";

export function CatalogVehicleSelector({ category, categoryLabel }: { category: string; categoryLabel: string }) {
  const [vehicle, setVehicle] = useState<VehicleContext | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const syncVehicle = () => setVehicle(readVehicleContextFromBrowser());
    const onStorage = (event: StorageEvent) => {
      if (event.key === vehicleContextStorageKey) syncVehicle();
    };

    syncVehicle();
    window.addEventListener("storage", onStorage);
    window.addEventListener(vehicleContextChangedEvent, syncVehicle);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(vehicleContextChangedEvent, syncVehicle);
    };
  }, []);

  if (!vehicle || editing) {
    return (
      <div className="relative">
        {vehicle ? (
          <button type="button" onClick={() => setEditing(false)} className="absolute right-3 top-3 z-10 text-[11px] font-black uppercase tracking-[0.08em] text-steel hover:text-ink">
            Cancel
          </button>
        ) : null}
        <VehiclePartsFinder compact category={category} />
      </div>
    );
  }

  const vehicleTitle = [vehicle.year, vehicle.make, vehicle.model, vehicle.chassis].filter(Boolean).join(" ");
  const vehicleDetail = [vehicle.bodyConfiguration, vehicle.engine].filter(Boolean).join(" · ");
  const destination = buildVehiclePartsHref(vehicle, category);
  const resultLabel = category === "all" ? "View compatible parts" : `View compatible ${categoryLabel.toLowerCase()}`;

  return (
    <section className="rounded-xl border border-emerald-700/20 bg-white p-4 text-ink shadow-panel sm:p-5" aria-label="Selected vehicle">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-700 text-white">
          <CarFront className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Selected vehicle</p>
          <h2 className="mt-1 truncate text-lg font-black">{vehicleTitle}</h2>
          {vehicleDetail ? <p className="mt-1 truncate text-xs font-bold text-steel">{vehicleDetail}</p> : null}
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <Link href={destination as never} className="inline-flex h-10 items-center justify-center rounded-lg bg-signal px-4 text-sm font-black text-white hover:bg-red-700">{resultLabel}</Link>
        <button type="button" onClick={() => setEditing(true)} className="inline-flex h-10 items-center justify-center rounded-lg border border-black/10 px-4 text-sm font-black hover:border-black/30">Change</button>
      </div>
    </section>
  );
}
