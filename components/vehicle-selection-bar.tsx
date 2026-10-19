"use client";

import Link from "next/link";
import { CarFront } from "lucide-react";
import { useEffect, useState } from "react";
import {
  persistVehicleContextCookie,
  readVehicleContextFromBrowser,
  vehicleContextChangedEvent,
  vehicleContextStorageKey,
  type VehicleContext
} from "@/lib/vehicle-context";

export function VehicleSelectionBar() {
  const [vehicle, setVehicle] = useState<VehicleContext | null>(null);

  useEffect(() => {
    const syncVehicle = () => {
      const storedVehicle = readVehicleContextFromBrowser();
      if (storedVehicle) persistVehicleContextCookie(storedVehicle);
      setVehicle(storedVehicle);
    };
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

  if (!vehicle) return null;

  const title = [vehicle.year, vehicle.make, vehicle.model, vehicle.chassis].filter(Boolean).join(" ");
  const detail = [vehicle.bodyConfiguration, vehicle.engine].filter(Boolean).join(" · ");

  return (
    <div className="border-b border-emerald-900/15 bg-emerald-50 text-ink">
      <div className="mx-auto flex min-h-9 max-w-7xl items-center gap-2 px-4 py-1.5 sm:px-6 lg:px-8">
        <CarFront className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-black sm:text-sm">
          {title}{detail ? <span className="hidden font-bold text-steel md:inline"> · {detail}</span> : null}
        </span>
        <Link href="/parts#change-vehicle" className="shrink-0 text-[11px] font-black uppercase tracking-[0.08em] text-signal hover:text-red-700">
          Change vehicle
        </Link>
      </div>
    </div>
  );
}
