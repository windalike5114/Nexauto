import Stripe from "stripe";
import type { CheckoutCouponAdapter } from "@/lib/application/checkout/create-checkout-session";
import type { CouponBenefit } from "@/lib/application/pricing/pricing-input";

export function createStripeCouponAdapter(stripe: Stripe): CheckoutCouponAdapter {
  return {
    async resolveCoupon(code) {
      const promotionCodes = await stripe.promotionCodes.list({
        active: true,
        code,
        limit: 1
      });
      const promotionCode = promotionCodes.data[0];

      if (!promotionCode || !promotionCode.coupon.valid) return null;

      return normalizeCouponBenefit(promotionCode);
    }
  };
}

function normalizeCouponBenefit(promotionCode: Stripe.PromotionCode): CouponBenefit | null {
  const coupon = promotionCode.coupon;

  if (coupon.percent_off) {
    return {
      code: promotionCode.code,
      label: `${coupon.percent_off}% off`,
      percentOff: coupon.percent_off
    };
  }

  if (coupon.amount_off && coupon.currency?.toLowerCase() === "nzd") {
    return {
      code: promotionCode.code,
      label: `${coupon.currency.toUpperCase()} ${(coupon.amount_off / 100).toFixed(2)} off`,
      amountOffMinor: coupon.amount_off
    };
  }

  return null;
}
