import { CustomerVehicleError } from "@/lib/domain/account/customer-vehicle.errors";
import type { CustomerVehicleInput, CustomerVehiclePatch } from "@/lib/domain/account/customer-vehicle.schema";
import type { CustomerVehicle, CustomerVehicleMutationContext } from "@/lib/domain/account/customer-vehicle.types";
import type { CustomerVehicleRepository } from "@/lib/application/account/customer-vehicle-repository";
import { createSupabaseAdminClient } from "@/lib/supabase";

type VehicleRow = {
  id: string;
  vehicle_application_id: string | null;
  label: string | null;
  make_snapshot: string;
  model_snapshot: string;
  year: number;
  source: string;
  is_default: boolean;
  last_used_at: string;
};

export function createSupabaseAccountVehicleRepository(): CustomerVehicleRepository {
  return {
    async save(context, input) {
      const { data, error } = await getAdmin().rpc("save_customer_vehicle", {
        p_auth_user_id: context.authUserId,
        p_vehicle_application_id: input.applicationId,
        p_year: input.year,
        p_label: input.label,
        p_source: input.source,
        p_is_default: input.isDefault
      });
      if (error) throw repositoryError(error);
      if (!data) throw new CustomerVehicleError("CUSTOMER_VEHICLE_REPOSITORY_FAILED", "Vehicle could not be saved.");
      return mapVehicle(data as VehicleRow);
    },

    async update(context, vehicleId, input) {
      const { data, error } = await getAdmin().rpc("update_customer_vehicle", {
        p_auth_user_id: context.authUserId,
        p_vehicle_id: vehicleId,
        p_label: input.label
      });
      if (error) throw repositoryError(error);
      if (!data) throw new CustomerVehicleError("CUSTOMER_VEHICLE_NOT_FOUND", "Vehicle was not found.");
      return mapVehicle(data as VehicleRow);
    },

    async delete(context, vehicleId) {
      const { data, error } = await getAdmin().rpc("delete_customer_vehicle", {
        p_auth_user_id: context.authUserId,
        p_vehicle_id: vehicleId
      });
      if (error) throw repositoryError(error);
      const row = Array.isArray(data) ? data[0] : data;
      return {
        deletedVehicleId: row?.deleted_vehicle_id ?? vehicleId,
        replacementDefaultVehicleId: row?.replacement_default_vehicle_id ?? null
      };
    },

    async setDefault(context, vehicleId) {
      const { data, error } = await getAdmin().rpc("set_default_customer_vehicle", {
        p_auth_user_id: context.authUserId,
        p_vehicle_id: vehicleId
      });
      if (error) throw repositoryError(error);
      if (!data) throw new CustomerVehicleError("CUSTOMER_VEHICLE_NOT_FOUND", "Vehicle was not found.");
      return mapVehicle(data as VehicleRow);
    }
  };
}

function mapVehicle(row: VehicleRow): CustomerVehicle {
  return {
    id: row.id,
    applicationId: row.vehicle_application_id,
    label: row.label,
    make: row.make_snapshot,
    model: row.model_snapshot,
    year: row.year,
    source: row.source,
    isDefault: row.is_default,
    lastUsedAt: row.last_used_at
  };
}

function repositoryError(error: { code?: string; message?: string }) {
  if (error.message?.includes("vehicle_not_found") || error.message?.includes("vehicle_application_not_found")) {
    return new CustomerVehicleError("CUSTOMER_VEHICLE_NOT_FOUND", "Vehicle was not found.");
  }
  if (error.message?.includes("customer_profile_not_found")) {
    return new CustomerVehicleError("CUSTOMER_VEHICLE_OWNERSHIP_FAILED", "Customer profile was not found.");
  }
  return new CustomerVehicleError("CUSTOMER_VEHICLE_REPOSITORY_FAILED", "Vehicle request could not be completed.");
}

function getAdmin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new CustomerVehicleError("CUSTOMER_VEHICLE_REPOSITORY_FAILED", "Vehicle service is not configured.");
  return supabase;
}
