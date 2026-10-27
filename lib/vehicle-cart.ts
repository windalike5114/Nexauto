import type { VehicleContext } from '@/lib/vehicle-context';
import type { CartItem } from '@/lib/types';

/** Snapshot the selected range per cart line, so changing the saved vehicle cannot reassign old purchases. */
export function vehicleCartAttributes(vehicle: VehicleContext | null, status?: string): CartItem['attributes'] {
  if (!vehicle) return {};
  return {
    vehicle_selection: JSON.stringify({ makeId: vehicle.makeId, modelId: vehicle.modelId, year: vehicle.year, variantGroup: vehicle.variantGroup, ...(vehicle.variantGroup ? {} : { applicationIds: vehicle.applicationIds ?? (vehicle.applicationId ? [vehicle.applicationId] : []) }) }),
    vehicle: [vehicle.year,vehicle.make,vehicle.model,vehicle.versionLabel].filter(Boolean).join(' · '),
    vehicle_make: vehicle.make, vehicle_model: vehicle.model, vehicle_year: vehicle.year,
    vehicle_body: vehicle.versionLabel || vehicle.bodyConfiguration || '',
    ...(status ? { vehicle_fitment_status: status } : {})
  };
}
