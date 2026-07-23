import { z } from "zod";
import { CurrencyCodeSchema, MinorUnitAmountSchema } from "@/lib/domain/shared/money";

export const PricingDiscountTypeSchema = z.enum(["bundle", "welcome_reward", "coupon", "manual"]);

export const PricingDiscountLineSchema = z
  .object({
    type: PricingDiscountTypeSchema,
    label: z.string().trim().min(1),
    amountMinor: MinorUnitAmountSchema,
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const PricingLineItemSchema = z
  .object({
    lineId: z.string().trim().min(1).optional(),
    productId: z.string().trim().min(1),
    variantId: z.string().trim().min(1),
    sku: z.string().trim().min(1),
    quantity: z.number().int().min(1),
    unitAmountMinor: MinorUnitAmountSchema,
    subtotalMinor: MinorUnitAmountSchema,
    discountMinor: MinorUnitAmountSchema.default(0),
    totalMinor: MinorUnitAmountSchema,
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const PricingResultSchema = z
  .object({
    currency: CurrencyCodeSchema,
    lines: z.array(PricingLineItemSchema),
    productSubtotalMinor: MinorUnitAmountSchema,
    discounts: z.array(PricingDiscountLineSchema).default([]),
    discountTotalMinor: MinorUnitAmountSchema.default(0),
    bundleDiscountMinor: MinorUnitAmountSchema.default(0),
    welcomeRewardMinor: MinorUnitAmountSchema.default(0),
    couponDiscountMinor: MinorUnitAmountSchema.default(0),
    shippingMinor: MinorUnitAmountSchema.default(0),
    taxIncludedMinor: MinorUnitAmountSchema.default(0),
    gstIncludedMinor: MinorUnitAmountSchema.default(0),
    grandTotalMinor: MinorUnitAmountSchema
  })
  .strict()
  .superRefine((value, context) => {
    const discountTotal = value.discounts.reduce((sum, discount) => sum + discount.amountMinor, 0);
    const expectedTotal = Math.max(0, value.productSubtotalMinor - value.discountTotalMinor) + value.shippingMinor;

    if (discountTotal !== value.discountTotalMinor) {
      context.addIssue({
        code: "custom",
        message: "Discount lines must reconcile to discountTotalMinor."
      });
    }

    if (expectedTotal !== value.grandTotalMinor) {
      context.addIssue({
        code: "custom",
        message: "Product subtotal minus discounts plus shipping must equal grandTotalMinor."
      });
    }

    if (value.taxIncludedMinor !== value.gstIncludedMinor) {
      context.addIssue({
        code: "custom",
        message: "taxIncludedMinor and gstIncludedMinor must match for GST-inclusive pricing."
      });
    }
  });
