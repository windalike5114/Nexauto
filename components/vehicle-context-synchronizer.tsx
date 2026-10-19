"use client";

import { useEffect } from "react";
import { saveVehicleContext, type VehicleContext } from "@/lib/vehicle-context";

export function VehicleContextSynchronizer({ vehicle }: { vehicle: VehicleContext }) {
  useEffect(() => {
    saveVehicleContext(vehicle);
  }, [vehicle]);

  return null;
}
