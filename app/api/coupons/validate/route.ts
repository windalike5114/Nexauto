import { NextResponse } from "next/server";
import Stripe from "stripe";

type CouponValidationRequest = {
  code?: string;
  amount?: number;
};

export async function POST(request: Request) {
  const { code, amount } = (await request.json()) as CouponValidationRequest;
  const normalizedCode = code?.trim();
  const orderAmount = Math.max(0, Number(amount) || 0);

  if (!normalizedCode) {
    return NextResponse.json({ error: "Enter a coupon code." }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Coupon validation is not configured." }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const promotionCodes = await stripe.promotionCodes.list({
    active: true,
    code: normalizedCode,
    limit: 1
  });
  const promotionCode = promotionCodes.data[0];

  if (!promotionCode || !promotionCode.coupon.valid) {
    return NextResponse.json({ error: "Coupon code is not valid or has expired." }, { status: 400 });
  }

  const coupon = promotionCode.coupon;
  const discount = getCouponDiscount(coupon, orderAmount);

  return NextResponse.json({
    code: promotionCode.code,
    discount,
    label: getCouponLabel(coupon)
  });
}

function getCouponDiscount(coupon: Stripe.Coupon, amount: number) {
  if (coupon.percent_off) {
    return roundMoney((amount * coupon.percent_off) / 100);
  }

  if (coupon.amount_off && coupon.currency?.toLowerCase() === "nzd") {
    return Math.min(amount, roundMoney(coupon.amount_off / 100));
  }

  return 0;
}

function getCouponLabel(coupon: Stripe.Coupon) {
  if (coupon.percent_off) return `${coupon.percent_off}% off`;
  if (coupon.amount_off && coupon.currency) return `${coupon.currency.toUpperCase()} ${(coupon.amount_off / 100).toFixed(2)} off`;
  return coupon.name ?? "Coupon applied";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
