import { z } from "zod";
import { AttributeRecordSchema } from "@/lib/domain/cart/cart.schema";
import { CurrencyCodeSchema, MinorUnitAmountSchema } from "@/lib/domain/shared/money";

export const PricingInputItemSchema = z
  .object({
    lineId: z.string().trim().min(1).optional(),
    productId: z.string().trim().min(1),
    variantId: z.string().trim().min(1),
    sku: z.string().trim().min(1),
    name: z.string().trim().min(1),
    category: z.string().trim().min(1).optional(),
    quantity: z.number().int().min(1).max(99),
    unitAmountMinor: MinorUnitAmountSchema,
    bundleEligible: z.boolean().default(false),
    bundleCategory: z.string().trim().min(1).optional(),
    attributes: AttributeRecordSchema.default({})
  })
  .strict();

export const CouponBenefitSchema = z
  .object({
    code: z.string().trim().min(1),
    label: z.string().trim().min(1),
    percentOff: z.number().positive().max(100).optional(),
    amountOffMinor: MinorUnitAmountSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.percentOff && !value.amountOffMinor) {
      context.addIssue({
        code: "custom",
        message: "Coupon benefit requires percentOff or amountOffMinor."
      });
    }
  });

export const PricingCustomerContextSchema = z
  .object({
    welcomeRewardEligible: z.boolean().default(false)
  })
  .strict();

export const PricingShippingContextSchema = z
  .object({
    country: z.literal("NZ").default("NZ"),
    promotionalFreeShipping: z.boolean().default(true),
    standardShippingMinor: MinorUnitAmountSchema.default(800)
  })
  .strict();

export const PricingInputSchema = z
  .object({
    currency: CurrencyCodeSchema.default("nzd"),
    items: z.array(PricingInputItemSchema).min(1),
    customer: PricingCustomerContextSchema.default({ welcomeRewardEligible: false }),
    coupon: CouponBenefitSchema.optional(),
    shipping: PricingShippingContextSchema.default({
      country: "NZ",
      promotionalFreeShipping: true,
      standardShippingMinor: 800
    })
  })
  .strict();

export type PricingInputItem = z.infer<typeof PricingInputItemSchema>;
export type CouponBenefit = z.infer<typeof CouponBenefitSchema>;
export type PricingInput = z.infer<typeof PricingInputSchema>;
