import { PricingResultSchema } from "@/lib/domain/pricing/pricing.schema";
import type { PricingDiscountLine, PricingLineItem, PricingResult } from "@/lib/domain/pricing/pricing.types";
import { pricingRules } from "@/lib/domain/pricing/pricing.rules";
import { PricingError } from "@/lib/domain/pricing/pricing.errors";
import { PricingInputSchema, type PricingInput, type PricingInputItem } from "./pricing-input";

export type PricedOrderLine = PricingLineItem & {
  name: string;
  bundleDiscountMinor: number;
  welcomeRewardMinor: number;
  couponDiscountMinor: number;
};

export type CalculatedOrderPricing = {
  result: PricingResult;
  lines: PricedOrderLine[];
};

export function calculateOrderPricing(input: PricingInput): CalculatedOrderPricing {
  const pricingInput = PricingInputSchema.parse(input);
  const baseLines = pricingInput.items.map(createBaseLine);
  const bundleDiscountMinor = calculateBundleDiscountMinor(pricingInput.items);
  const linesAfterBundle = allocateDiscount(baseLines, bundleDiscountMinor, (line) => Boolean(line.metadata.bundleEligible), "bundleDiscountMinor");
  const subtotalAfterBundle = sumLineTotals(linesAfterBundle);
  const welcomeRewardMinor = pricingInput.customer.welcomeRewardEligible
    ? Math.min(pricingRules.welcomeReward.amountMinor, subtotalAfterBundle)
    : 0;
  const linesAfterWelcome = allocateDiscount(linesAfterBundle, welcomeRewardMinor, () => true, "welcomeRewardMinor");
  const subtotalAfterWelcome = sumLineTotals(linesAfterWelcome);
  const couponDiscountMinor = calculateCouponDiscountMinor(pricingInput.coupon, subtotalAfterWelcome);
  const finalLines = allocateDiscount(linesAfterWelcome, couponDiscountMinor, () => true, "couponDiscountMinor");
  const productSubtotalMinor = baseLines.reduce((sum, line) => sum + line.subtotalMinor, 0);
  const shippingMinor = pricingInput.shipping.promotionalFreeShipping ? pricingRules.shipping.promotionalFreeShippingMinor : pricingInput.shipping.standardShippingMinor;
  const discountLines = buildDiscountLines({
    bundleDiscountMinor,
    welcomeRewardMinor,
    couponDiscountMinor,
    couponLabel: pricingInput.coupon?.label,
    couponCode: pricingInput.coupon?.code
  });
  const discountTotalMinor = discountLines.reduce((sum, discount) => sum + discount.amountMinor, 0);
  const grandTotalMinor = Math.max(0, productSubtotalMinor - discountTotalMinor) + shippingMinor;
  const gstIncludedMinor = Math.round((grandTotalMinor * pricingRules.gst.inclusiveRateNumerator) / pricingRules.gst.inclusiveRateDenominator);
  const result = PricingResultSchema.parse({
    currency: pricingInput.currency,
    lines: finalLines.map(({ name: _name, bundleDiscountMinor: _bundle, welcomeRewardMinor: _welcome, couponDiscountMinor: _coupon, ...line }) => line),
    productSubtotalMinor,
    discounts: discountLines,
    discountTotalMinor,
    bundleDiscountMinor,
    welcomeRewardMinor,
    couponDiscountMinor,
    shippingMinor,
    taxIncludedMinor: gstIncludedMinor,
    gstIncludedMinor,
    grandTotalMinor
  });

  return {
    result,
    lines: finalLines
  };
}

function createBaseLine(item: PricingInputItem): PricedOrderLine {
  const subtotalMinor = item.unitAmountMinor * item.quantity;

  if (subtotalMinor < 0) {
    throw new PricingError("Line subtotal cannot be negative.", "NEGATIVE_LINE_SUBTOTAL");
  }

  return {
    lineId: item.lineId,
    productId: item.productId,
    variantId: item.variantId,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitAmountMinor: item.unitAmountMinor,
    subtotalMinor,
    discountMinor: 0,
    totalMinor: subtotalMinor,
    bundleDiscountMinor: 0,
    welcomeRewardMinor: 0,
    couponDiscountMinor: 0,
    metadata: {
      bundleEligible: item.bundleEligible,
      bundleCategory: item.bundleCategory,
      category: item.category,
      attributes: item.attributes
    }
  };
}

function calculateBundleDiscountMinor(items: PricingInputItem[]) {
  const eligibleUnits = items
    .filter((item) => item.bundleEligible && item.bundleCategory === pricingRules.frontWiperPairBundle.eligibleCategory)
    .flatMap((item) => Array.from({ length: item.quantity }, () => item.unitAmountMinor))
    .sort((a, b) => b - a);
  const eligibleSubtotal = eligibleUnits.reduce((sum, amount) => sum + amount, 0);
  let bundledTotal = 0;
  let index = 0;

  while (eligibleUnits.length - index >= 3) {
    bundledTotal += pricingRules.frontWiperPairBundle.threePairTotalMinor;
    index += 3;
  }

  if (eligibleUnits.length - index === 2) {
    bundledTotal += pricingRules.frontWiperPairBundle.twoPairTotalMinor;
    index += 2;
  }

  while (index < eligibleUnits.length) {
    bundledTotal += eligibleUnits[index];
    index += 1;
  }

  return Math.max(0, eligibleSubtotal - bundledTotal);
}

function calculateCouponDiscountMinor(coupon: PricingInput["coupon"], amountMinor: number) {
  if (!coupon || amountMinor <= 0) return 0;

  if (coupon.percentOff) {
    return Math.min(amountMinor, Math.round((amountMinor * coupon.percentOff) / 100));
  }

  if (coupon.amountOffMinor) {
    return Math.min(amountMinor, coupon.amountOffMinor);
  }

  return 0;
}

function allocateDiscount(
  lines: PricedOrderLine[],
  discountMinor: number,
  isEligible: (line: PricedOrderLine) => boolean,
  field: "bundleDiscountMinor" | "welcomeRewardMinor" | "couponDiscountMinor"
) {
  if (discountMinor <= 0) return lines;

  const eligible = lines.map((line, index) => ({ line, index })).filter(({ line }) => isEligible(line) && line.totalMinor > 0);
  const eligibleSubtotal = eligible.reduce((sum, { line }) => sum + line.totalMinor, 0);

  if (eligibleSubtotal <= 0) return lines;

  let remainingDiscount = Math.min(discountMinor, eligibleSubtotal);
  const next = [...lines];

  eligible.forEach(({ line, index }, position) => {
    const isLast = position === eligible.length - 1;
    const lineDiscount = isLast ? remainingDiscount : Math.round((discountMinor * line.totalMinor) / eligibleSubtotal);
    const safeLineDiscount = Math.min(line.totalMinor, lineDiscount);
    remainingDiscount -= safeLineDiscount;
    next[index] = {
      ...line,
      [field]: line[field] + safeLineDiscount,
      discountMinor: line.discountMinor + safeLineDiscount,
      totalMinor: line.totalMinor - safeLineDiscount
    };
  });

  return next;
}

function buildDiscountLines({
  bundleDiscountMinor,
  welcomeRewardMinor,
  couponDiscountMinor,
  couponLabel,
  couponCode
}: {
  bundleDiscountMinor: number;
  welcomeRewardMinor: number;
  couponDiscountMinor: number;
  couponLabel?: string;
  couponCode?: string;
}): PricingDiscountLine[] {
  const discounts: PricingDiscountLine[] = [];

  if (bundleDiscountMinor > 0) {
    discounts.push({
      type: "bundle",
      label: bundleDiscountMinor >= 3000 ? pricingRules.frontWiperPairBundle.threePairLabel : pricingRules.frontWiperPairBundle.twoPairLabel,
      amountMinor: bundleDiscountMinor,
      metadata: {}
    });
  }

  if (welcomeRewardMinor > 0) {
    discounts.push({
      type: "welcome_reward",
      label: pricingRules.welcomeReward.label,
      amountMinor: welcomeRewardMinor,
      metadata: {}
    });
  }

  if (couponDiscountMinor > 0) {
    discounts.push({
      type: "coupon",
      label: couponLabel ?? "Coupon",
      amountMinor: couponDiscountMinor,
      metadata: couponCode ? { code: couponCode } : {}
    });
  }

  return discounts;
}

function sumLineTotals(lines: PricedOrderLine[]) {
  return lines.reduce((sum, line) => sum + line.totalMinor, 0);
}
