import type { z } from "zod";
import type { PricingDiscountLineSchema, PricingDiscountTypeSchema, PricingLineItemSchema, PricingResultSchema } from "./pricing.schema";

export type PricingDiscountType = z.infer<typeof PricingDiscountTypeSchema>;
export type PricingDiscountLine = z.infer<typeof PricingDiscountLineSchema>;
export type PricingLineItem = z.infer<typeof PricingLineItemSchema>;
export type PricingResult = z.infer<typeof PricingResultSchema>;
