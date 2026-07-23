import type { CustomerVehicleMutationContext } from "@/lib/domain/account/customer-vehicle.types";
import type { CustomerVehicleRepository } from "@/lib/application/account/customer-vehicle-repository";

export async function deleteCustomerVehicleForAccount(context: CustomerVehicleMutationContext, vehicleId: string, repository: CustomerVehicleRepository) {
  return repository.delete(context, vehicleId);
}
