export const vehicleContextStorageKey = "nexauto.vehicle-context.v2";
export const vehicleContextCookieKey = "nexauto_vehicle_context_v2";
export const vehicleContextChangedEvent = "nexauto:vehicle-context-changed";

export type VehicleContext = {
  makeId: string;
  modelId: string;
  year: string;
  make: string;
  model: string;
  applicationId?: string;
  generationId?: string;
  variantId?: string;
  chassis?: string;
  bodyConfiguration?: string;
  engine?: string;
};

export function parseVehicleContext(value: string | null): VehicleContext | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<VehicleContext>;
    if (!parsed.makeId || !parsed.modelId || !parsed.year || !parsed.make || !parsed.model) return null;
    return {
      makeId: parsed.makeId,
      modelId: parsed.modelId,
      year: parsed.year,
      make: parsed.make,
      model: parsed.model,
      applicationId: parsed.applicationId,
      generationId: parsed.generationId,
      variantId: parsed.variantId,
      chassis: parsed.chassis,
      bodyConfiguration: parsed.bodyConfiguration,
      engine: parsed.engine
    };
  } catch {
    return null;
  }
}

export function saveVehicleContext(context: VehicleContext) {
  const serialized = JSON.stringify(context);
  window.localStorage.setItem(vehicleContextStorageKey, serialized);
  persistVehicleContextCookie(context);
  window.dispatchEvent(new CustomEvent(vehicleContextChangedEvent, { detail: context }));
}

export function readVehicleContextFromBrowser() {
  return parseVehicleContext(window.localStorage.getItem(vehicleContextStorageKey));
}

export function persistVehicleContextCookie(context: VehicleContext) {
  document.cookie = `${vehicleContextCookieKey}=${encodeURIComponent(JSON.stringify(context))}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

export function clearVehicleContext() {
  window.localStorage.removeItem(vehicleContextStorageKey);
  document.cookie = `${vehicleContextCookieKey}=; Max-Age=0; Path=/; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(vehicleContextChangedEvent, { detail: null }));
}

