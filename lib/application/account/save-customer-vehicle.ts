import { parseCustomerVehicleInput } from "@/lib/domain/account/customer-vehicle.schema";
import type { CustomerVehicleMutationContext } from "@/lib/domain/account/customer-vehicle.types";
import type { CustomerVehicleRepository } from "@/lib/application/account/customer-vehicle-repository";

export async function saveCustomerVehicleForAccount(context: CustomerVehicleMutationContext, input: unknown, repository: CustomerVehicleRepository) {
  return repository.save(context, parseCustomerVehicleInput(input));
}
