export type CustomerVehicleErrorCode =
  | "CUSTOMER_VEHICLE_VALIDATION_FAILED"
  | "CUSTOMER_VEHICLE_NOT_FOUND"
  | "CUSTOMER_VEHICLE_REPOSITORY_FAILED"
  | "CUSTOMER_VEHICLE_OWNERSHIP_FAILED";

export class CustomerVehicleError extends Error {
  constructor(
    public readonly code: CustomerVehicleErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CustomerVehicleError";
  }
}
