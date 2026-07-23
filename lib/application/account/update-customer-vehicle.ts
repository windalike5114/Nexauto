import { parseCustomerVehiclePatch } from "@/lib/domain/account/customer-vehicle.schema";
import type { CustomerVehicleMutationContext } from "@/lib/domain/account/customer-vehicle.types";
import type { CustomerVehicleRepository } from "@/lib/application/account/customer-vehicle-repository";

export async function updateCustomerVehicleForAccount(context: CustomerVehicleMutationContext, vehicleId: string, input: unknown, repository: CustomerVehicleRepository) {
  return repository.update(context, vehicleId, parseCustomerVehiclePatch(input));
}
