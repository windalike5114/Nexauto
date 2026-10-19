import "server-only";

import { cookies } from "next/headers";
import {
  parseVehicleContext,
  vehicleContextCookieKey,
  type VehicleContext
} from "@/lib/vehicle-context";

export async function readStoredVehicleContext(): Promise<VehicleContext | null> {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(vehicleContextCookieKey)?.value;
  if (!encoded) return null;

  try {
    return parseVehicleContext(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}
