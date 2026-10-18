export const vehicleContextStorageKey = "nexauto.vehicle-context.v1";
export const vehicleContextChangedEvent = "nexauto:vehicle-context-changed";

export type VehicleContext = {
  makeId: string;
  modelId: string;
  year: string;
  make: string;
  model: string;
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
      model: parsed.model
    };
  } catch {
    return null;
  }
}

export function saveVehicleContext(context: VehicleContext) {
  window.localStorage.setItem(vehicleContextStorageKey, JSON.stringify(context));
  window.dispatchEvent(new CustomEvent(vehicleContextChangedEvent, { detail: context }));
}

