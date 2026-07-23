import type { CustomerVehicleInput, CustomerVehiclePatch } from "@/lib/domain/account/customer-vehicle.schema";
import type { CustomerVehicle, CustomerVehicleMutationContext, DeleteCustomerVehicleResult } from "@/lib/domain/account/customer-vehicle.types";

export type CustomerVehicleRepository = {
  save(context: CustomerVehicleMutationContext, input: CustomerVehicleInput): Promise<CustomerVehicle>;
  update(context: CustomerVehicleMutationContext, vehicleId: string, input: CustomerVehiclePatch): Promise<CustomerVehicle>;
  delete(context: CustomerVehicleMutationContext, vehicleId: string): Promise<DeleteCustomerVehicleResult>;
  setDefault(context: CustomerVehicleMutationContext, vehicleId: string): Promise<CustomerVehicle>;
};
