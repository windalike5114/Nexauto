import "server-only";

import { cookies } from "next/headers";
import { cache } from 'react';
import { resolveVehicleSelection } from '@/lib/server/resolve-vehicle-selection';
import {
  parseVehicleContext,
  globalVehicleContext,
  vehicleContextCookieKey,
  type VehicleContext
} from "@/lib/vehicle-context";

export const readStoredVehicleContext = cache(async (): Promise<VehicleContext | null> => {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(vehicleContextCookieKey)?.value;
  if (!encoded) return null;

  try {
    const parsed = globalVehicleContext(parseVehicleContext(decodeURIComponent(encoded)));
    if (!parsed) return null;
    const resolved = await resolveVehicleSelection(parsed);
    return globalVehicleContext(resolved?.vehicle ?? null);
  } catch {
    return null;
  }
});
