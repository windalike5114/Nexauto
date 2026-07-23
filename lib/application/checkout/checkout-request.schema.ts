import { z } from "zod";
import { CartSchema, CartVehicleContextSchema } from "@/lib/domain/cart/cart.schema";

export const CheckoutCustomerContextSchema = z
  .object({
    email: z.string().email().optional(),
    userId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional()
  })
  .strict();

export const CheckoutRequestSchema = z
  .object({
    cart: CartSchema.optional(),
    customer: CheckoutCustomerContextSchema.optional(),
    vehicle: CartVehicleContextSchema.optional(),
    couponCode: z.string().trim().min(1).max(64).optional(),
    welcomeRewardApplied: z.boolean().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.cart?.items.length) {
      context.addIssue({
        code: "custom",
        message: "Checkout requires at least one cart item."
      });
    }
  });
