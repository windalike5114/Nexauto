import { z } from "zod";

export const AttributeValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const AttributeRecordSchema = z.record(z.string(), AttributeValueSchema);

export const CartProductReferenceSchema = z
  .object({
    productId: z.string().trim().min(1).optional(),
    variantId: z.string().trim().min(1).optional(),
    sku: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.productId && !value.variantId && !value.sku) {
      context.addIssue({
        code: "custom",
        message: "A product, variant, or SKU identifier is required."
      });
    }
  });

export const CartVehicleContextSchema = z
  .object({
    applicationId: z.string().trim().min(1).optional(),
    make: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    series: z.string().trim().optional(),
    body: z.string().trim().optional(),
    label: z.string().trim().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const hasStructuredVehicle = Boolean(value.applicationId || value.make || value.model || value.year || value.series || value.body);

    if (!hasStructuredVehicle) return;

    if (!value.make || !value.model || !value.year) {
      context.addIssue({
        code: "custom",
        message: "Vehicle make, model, and year are required when vehicle context is provided."
      });
    }
  });

export const SelectedFitmentSchema = z
  .object({
    driverLengthIn: z.number().positive().optional(),
    passengerLengthIn: z.number().positive().optional(),
    rearLengthIn: z.number().positive().nullable().optional(),
    connectorCode: z.string().trim().min(1).optional()
  })
  .strict();

export const CartPromotionInputSchema = z
  .object({
    couponCode: z.string().trim().min(1).max(64).optional(),
    welcomeRewardRequested: z.boolean().optional()
  })
  .strict();

export const CartItemSchema = z
  .object({
    product: CartProductReferenceSchema,
    quantity: z.number().int().min(1).max(99),
    vehicle: CartVehicleContextSchema.optional(),
    selectedFitment: SelectedFitmentSchema.optional(),
    attributes: AttributeRecordSchema.default({})
  })
  .strict();

export const CartSchema = z
  .object({
    items: z.array(CartItemSchema).min(1),
    promotion: CartPromotionInputSchema.optional()
  })
  .strict();
