"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { clearVehicleContext } from "@/lib/vehicle-context";

export function ClearVehicleButton({ href }: { href: string }) {
  const router = useRouter();

  function clearVehicle() {
    clearVehicleContext();
    router.push(href as never);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={clearVehicle}
      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-signal hover:text-signal"
      aria-label="Remove selected vehicle and view all products"
    >
      <X className="h-4 w-4" aria-hidden />
      Clear vehicle &amp; view all
    </button>
  );
}
