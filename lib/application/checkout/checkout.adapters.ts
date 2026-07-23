import { ZodError } from "zod";
import { adaptLegacyCheckoutPayload, LegacyCheckoutPayloadSchema } from "@/lib/domain/cart/cart.adapters";
import type { Cart } from "@/lib/domain/cart/cart.types";
import type { CartItem as LegacyCartItem } from "@/lib/types";

export type ValidatedCheckoutRequest = {
  cart: Cart;
  legacyItems: LegacyCartItem[];
  couponCode?: string;
  welcomeRewardApplied: boolean;
};

export type CheckoutValidationResult =
  | { ok: true; data: ValidatedCheckoutRequest }
  | { ok: false; error: string; issues: string[] };

export function validateCheckoutRequest(input: unknown): CheckoutValidationResult {
  try {
    const legacyPayload = LegacyCheckoutPayloadSchema.parse(input);
    return {
      ok: true,
      data: adaptLegacyCheckoutPayload(legacyPayload)
    };
  } catch (error) {
    return {
      ok: false,
      error: "Checkout request is invalid.",
      issues: error instanceof ZodError ? error.issues.map((issue) => issue.message) : ["Unknown checkout validation error."]
    };
  }
}
