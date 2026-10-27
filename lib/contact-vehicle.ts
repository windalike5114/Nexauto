import { vehicleContextDetails, vehicleContextLabel, type VehicleContext } from './vehicle-context';

/** Current server-verified context takes precedence over a vehicle in an old enquiry URL. */
export function contactMessageWithVehicle(message: string, vehicle: VehicleContext | null, manualVehicle = '') {
  const label = vehicle ? [vehicleContextLabel(vehicle),vehicleContextDetails(vehicle)].filter(Boolean).join(' · ') : manualVehicle.trim();
  return label ? `Vehicle: ${label}\n\n${message}` : message;
}
