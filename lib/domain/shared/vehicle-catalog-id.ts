import { isLooseUuid } from "@/lib/domain/shared/uuid";

export const vehicleCatalogApplicationIdPattern = /^ap_[0-9a-f]{20}$/;

export function isVehicleCatalogApplicationId(value: unknown): value is string {
  return typeof value === "string" && vehicleCatalogApplicationIdPattern.test(value);
}

export function isSupportedVehicleApplicationId(value: unknown): value is string {
  return typeof value === "string" && (isVehicleCatalogApplicationId(value) || isLooseUuid(value));
}
