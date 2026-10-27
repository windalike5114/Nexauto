export const vehicleContextStorageKey = "nexauto.vehicle-context.v3";
export const vehicleContextCookieKey = "nexauto_vehicle_context_v3";
export const vehicleContextChangedEvent = "nexauto:vehicle-context-changed";

export type VehicleContext = {
  makeId: string;
  modelId: string;
  year: string;
  make: string;
  model: string;
  applicationId?: string;
  applicationIds?: string[];
  generationId?: string;
  variantId?: string;
  variantName?: string;
  chassis?: string;
  bodyConfiguration?: string;
  engine?: string;
  variantGroup?: string;
  versionLabel?: string;
};

export function isCompleteVehicleContext(context: VehicleContext | null | undefined): context is VehicleContext & { applicationId: string } {
  if (!context || ![context.makeId, context.modelId, context.year, context.make, context.model, context.applicationId].every(value => typeof value === 'string' && value.trim())) return false;
  const year = Number(context.year);
  const ids = [...new Set(context.applicationIds ?? [context.applicationId])];
  return Number.isInteger(year) && year >= 1886 && year <= 2100 && ids.length === 1 && ids[0] === context.applicationId;
}

export function globalVehicleContext(context: VehicleContext | null): VehicleContext | null {
  return isCompleteVehicleContext(context) ? { ...context, variantGroup: undefined, applicationIds: [context.applicationId] } : null;
}

export function sameVehicleContext(a: VehicleContext | null, b: VehicleContext | null) {
  return a === b || Boolean(a && b && a.makeId === b.makeId && a.modelId === b.modelId && a.year === b.year && a.applicationId === b.applicationId);
}

export function vehicleContextLabel(vehicle: VehicleContext) {
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
}

export function vehicleContextDetails(vehicle: VehicleContext) {
  return [...new Set([vehicle.chassis, vehicle.engine, vehicle.variantName || vehicle.versionLabel || vehicle.bodyConfiguration].filter(Boolean))].join(' · ');
}

/** Vehicle identity belongs to the shared context, not to a stale product URL. */
export function withoutVehicleParams(value: string, clear = false) {
  const url = new URL(value, 'https://nexautoparts.co.nz');
  for (const key of ['makeId','modelId','year','applicationId','applicationIds','applicationKind','variantGroup','make','model','bodyChassis','vehicle']) url.searchParams.delete(key);
  if (clear) url.searchParams.delete('fit');
  url.searchParams.delete('page');
  if (['#change-vehicle','#refine-vehicle'].includes(url.hash)) url.hash = '';
  return `${url.pathname}${url.search}${url.hash}`;
}

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
      applicationId: typeof parsed.applicationId === 'string' ? parsed.applicationId : undefined,
      applicationIds: Array.isArray(parsed.applicationIds) ? parsed.applicationIds.filter((id): id is string => typeof id === "string") : undefined,
      generationId: parsed.generationId,
      variantId: parsed.variantId,
      variantName: typeof parsed.variantName === 'string' ? parsed.variantName : undefined,
      chassis: parsed.chassis,
      bodyConfiguration: parsed.bodyConfiguration,
      engine: parsed.engine,
      variantGroup: typeof parsed.variantGroup === 'string' ? parsed.variantGroup : undefined,
      versionLabel: typeof parsed.versionLabel === 'string' ? parsed.versionLabel : undefined
    };
  } catch {
    return null;
  }
}

export function saveVehicleContext(context: VehicleContext) {
  const complete = globalVehicleContext(context);
  if (!complete) return false;
  const serialized = JSON.stringify(complete);
  window.localStorage.setItem(vehicleContextStorageKey, serialized);
  persistVehicleContextCookie(complete);
  window.dispatchEvent(new CustomEvent(vehicleContextChangedEvent, { detail: complete }));
  return true;
}

export function readVehicleContextFromBrowser() {
  return globalVehicleContext(parseVehicleContext(window.localStorage.getItem(vehicleContextStorageKey)));
}

export function persistVehicleContextCookie(context: VehicleContext) {
  const complete = globalVehicleContext(context);
  if (!complete) return;
  document.cookie = `${vehicleContextCookieKey}=${encodeURIComponent(JSON.stringify(complete))}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

export function clearVehicleContext() {
  window.localStorage.removeItem(vehicleContextStorageKey);
  document.cookie = `${vehicleContextCookieKey}=; Max-Age=0; Path=/; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(vehicleContextChangedEvent, { detail: null }));
}

