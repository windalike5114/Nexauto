import { calculateCartLinePricing, calculateCartPricing } from "@/lib/pricing";
import type { CartItem } from "@/lib/types";
import { fromMinorUnits, toMinorUnits } from "@/lib/domain/shared/money";
import type { CalculatedOrderPricing } from "./calculate-order-pricing";

export type PricingComparison = {
  productsSubtotalMatches: boolean;
  bundleDiscountMatches: boolean;
  totalBeforeExternalCouponMatches: boolean;
  oldProductsSubtotal: number;
  newProductsSubtotal: number;
  oldBundleDiscount: number;
  newBundleDiscount: number;
  oldTotalBeforeExternalCoupon: number;
  newTotalBeforeExternalCoupon: number;
};

export function compareLegacyCartPricing(cartItems: CartItem[], calculated: CalculatedOrderPricing, welcomeRewardDiscount = 0): PricingComparison {
  const legacyPricing = calculateCartPricing(cartItems);
  const legacyLines = calculateCartLinePricing(cartItems);
  const oldTotalBeforeExternalCoupon = legacyLines.reduce((sum, line) => sum + line.finalLineTotal, 0) - welcomeRewardDiscount;
  const newTotalBeforeExternalCoupon = fromMinorUnits(calculated.result.grandTotalMinor);

  return {
    productsSubtotalMatches: toMinorUnits(legacyPricing.productsSubtotal) === calculated.result.productSubtotalMinor,
    bundleDiscountMatches: toMinorUnits(legacyPricing.bundleDiscount) === calculated.result.bundleDiscountMinor,
    totalBeforeExternalCouponMatches: toMinorUnits(oldTotalBeforeExternalCoupon) === calculated.result.grandTotalMinor,
    oldProductsSubtotal: legacyPricing.productsSubtotal,
    newProductsSubtotal: fromMinorUnits(calculated.result.productSubtotalMinor),
    oldBundleDiscount: legacyPricing.bundleDiscount,
    newBundleDiscount: fromMinorUnits(calculated.result.bundleDiscountMinor),
    oldTotalBeforeExternalCoupon,
    newTotalBeforeExternalCoupon
  };
}
