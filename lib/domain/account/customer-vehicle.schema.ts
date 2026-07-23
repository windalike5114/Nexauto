import { z } from "zod";
import { CustomerVehicleError } from "@/lib/domain/account/customer-vehicle.errors";

const forbiddenOwnershipFields = ["customerProfileId", "customer_profile_id", "authUserId", "auth_user_id", "userId", "email"];

const BaseVehicleSchema = z
  .object({
    applicationId: z.string().uuid("Vehicle application id is invalid."),
    year: z.coerce.number().int().min(1900).max(2100),
    label: z.string().trim().max(80).nullable().optional(),
    source: z.string().trim().max(40).optional(),
    isDefault: z.boolean().optional()
  })
  .passthrough()
  .superRefine((value, context) => {
    for (const field of forbiddenOwnershipFields) {
      if (field in value) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} cannot be submitted by the browser.`,
          path: [field]
        });
      }
    }
  });

export const CustomerVehicleInputSchema = BaseVehicleSchema.transform((value) => ({
  applicationId: value.applicationId,
  year: value.year,
  label: normalizeOptionalText(value.label),
  source: normalizeOptionalText(value.source) ?? "fitment_lookup",
  isDefault: value.isDefault ?? false
}));

export const CustomerVehiclePatchSchema = z
  .object({
    label: z.string().trim().max(80).nullable().optional()
  })
  .passthrough()
  .superRefine((value, context) => {
    for (const field of [...forbiddenOwnershipFields, "applicationId", "vehicle_application_id", "year", "make", "model"]) {
      if (field in value) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} cannot be changed from this form.`,
          path: [field]
        });
      }
    }
  })
  .transform((value) => ({
    label: normalizeOptionalText(value.label)
  }));

export type CustomerVehicleInput = z.infer<typeof CustomerVehicleInputSchema>;
export type CustomerVehiclePatch = z.infer<typeof CustomerVehiclePatchSchema>;

export function parseCustomerVehicleInput(input: unknown) {
  const parsed = CustomerVehicleInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CustomerVehicleError("CUSTOMER_VEHICLE_VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Vehicle details are invalid.");
  }
  return parsed.data;
}

export function parseCustomerVehiclePatch(input: unknown) {
  const parsed = CustomerVehiclePatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new CustomerVehicleError("CUSTOMER_VEHICLE_VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Vehicle details are invalid.");
  }
  return parsed.data;
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
