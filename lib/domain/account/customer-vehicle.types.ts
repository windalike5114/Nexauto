export type CustomerVehicle = {
  id: string;
  applicationId: string | null;
  label: string | null;
  make: string;
  model: string;
  year: number;
  source: string;
  isDefault: boolean;
  lastUsedAt: string;
};

export type CustomerVehicleMutationContext = {
  authUserId: string;
  customerProfileId: string;
};

export type DeleteCustomerVehicleResult = {
  deletedVehicleId: string;
  replacementDefaultVehicleId: string | null;
};
