import { z } from "zod";

export const CheckoutShippingAddressSchema = z
  .object({
    recipientName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(7).max(40),
    line1: z.string().trim().min(3).max(160),
    line2: z.string().trim().max(160).optional(),
    suburb: z.string().trim().max(80).optional(),
    city: z.string().trim().min(2).max(80),
    region: z.string().trim().max(80).optional(),
    postcode: z.string().trim().min(3).max(10),
    country: z.literal("NZ"),
    source: z.enum(["geoapify", "manual", "saved"]).optional(),
    formatted: z.string().trim().max(240).optional(),
    placeId: z.string().trim().max(200).optional()
  })
  .strict();

export type CheckoutShippingAddress = z.infer<typeof CheckoutShippingAddressSchema>;
