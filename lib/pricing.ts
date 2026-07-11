import type { CartItem } from "@/lib/types";

export const wiperPairPricing = {
  compareAtPrice: 79.99,
  salePrice: 59.99,
  memberPrice: 54.99,
  bundleTotals: {
    2: 109.99,
    3: 149.99
  }
};

export const frontWiperPairBundle = {
  eligibleCategory: "front-wiper-pair",
  twoPairLabel: "2-Pair Bundle Applied",
  threePairLabel: "3-Pair Bundle Applied"
};

export function getWiperPairLineTotal(qty: number, unitPrice = wiperPairPricing.salePrice) {
  const safeQty = Math.max(1, Math.floor(qty));

  if (safeQty === 2) return wiperPairPricing.bundleTotals[2];
  if (safeQty === 3) return wiperPairPricing.bundleTotals[3];

  return safeQty * unitPrice;
}

export function getCartItemLineTotal({
  productId,
  price,
  qty
}: {
  productId: string;
  price: number;
  qty: number;
}) {
  if (productId === "wiper_set") {
    return getWiperPairLineTotal(qty, price);
  }

  return price * qty;
}

export function getWiperBundleSavings(qty: number, unitPrice = wiperPairPricing.salePrice) {
  return Math.max(0, qty * unitPrice - getWiperPairLineTotal(qty, unitPrice));
}

export type CartPricingSummary = {
  productsSubtotal: number;
  bundleDiscount: number;
  subtotal: number;
  eligiblePairQuantity: number;
  bundleLabel: string;
  bundleProgressMessage: string;
  bundleApplied: boolean;
};

export type OrderTotals = {
  subtotal: number;
  shipping: number;
  gstIncluded: number;
  orderTotal: number;
  discount: number;
  grandTotal: number;
};

export type CartLinePricing = {
  item: CartItem;
  baseLineTotal: number;
  bundleDiscount: number;
  finalLineTotal: number;
};

export function calculateCartPricing(items: CartItem[]): CartPricingSummary {
  const productsSubtotal = roundMoney(items.reduce((sum, item) => sum + item.price * item.qty, 0));
  const eligibleItems = items.filter(isFrontWiperPairBundleEligible);
  const eligiblePairQuantity = eligibleItems.reduce((sum, item) => sum + item.qty, 0);
  const eligibleSubtotal = eligibleItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const bundledEligibleTotal = getBundledFrontPairTotal(eligibleItems);
  const bundleDiscount = roundMoney(Math.max(0, eligibleSubtotal - bundledEligibleTotal));
  const subtotal = roundMoney(productsSubtotal - bundleDiscount);
  const bundleLabel = eligiblePairQuantity >= 3 ? frontWiperPairBundle.threePairLabel : eligiblePairQuantity >= 2 ? frontWiperPairBundle.twoPairLabel : "";

  return {
    productsSubtotal,
    bundleDiscount,
    subtotal,
    eligiblePairQuantity,
    bundleLabel,
    bundleProgressMessage: getBundleProgressMessage(eligiblePairQuantity, bundleDiscount, bundleLabel),
    bundleApplied: bundleDiscount > 0
  };
}

export function calculateCartLinePricing(items: CartItem[]): CartLinePricing[] {
  const pricing = calculateCartPricing(items);
  const baseLines = items.map((item) => ({
    item,
    baseLineTotal: roundMoney(item.price * item.qty),
    bundleDiscount: 0,
    finalLineTotal: roundMoney(item.price * item.qty)
  }));

  if (pricing.bundleDiscount <= 0) return baseLines;

  const eligibleIndexes = baseLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isFrontWiperPairBundleEligible(line.item));
  const eligibleSubtotal = eligibleIndexes.reduce((sum, { line }) => sum + line.baseLineTotal, 0);
  let remainingDiscount = pricing.bundleDiscount;

  eligibleIndexes.forEach(({ line, index }, position) => {
    const isLast = position === eligibleIndexes.length - 1;
    const discount = isLast ? remainingDiscount : roundMoney((pricing.bundleDiscount * line.baseLineTotal) / eligibleSubtotal);
    remainingDiscount = roundMoney(remainingDiscount - discount);
    baseLines[index] = {
      ...line,
      bundleDiscount: discount,
      finalLineTotal: roundMoney(line.baseLineTotal - discount)
    };
  });

  return baseLines;
}

export function isFrontWiperPairBundleEligible(item: Pick<CartItem, "productId" | "bundleEligible" | "bundleCategory">) {
  return item.bundleEligible === true && item.bundleCategory === frontWiperPairBundle.eligibleCategory;
}

export function calculateOrderTotals(pricing: CartPricingSummary, couponDiscount = 0): OrderTotals {
  const discount = roundMoney(pricing.bundleDiscount + Math.max(0, couponDiscount));
  const grandTotal = roundMoney(Math.max(0, pricing.productsSubtotal - discount));

  return {
    subtotal: pricing.productsSubtotal,
    shipping: 0,
    gstIncluded: roundMoney((grandTotal * 3) / 23),
    orderTotal: pricing.productsSubtotal,
    discount,
    grandTotal
  };
}

function getBundledFrontPairTotal(items: CartItem[]) {
  const unitPrices = items.flatMap((item) => Array.from({ length: item.qty }, () => item.price)).sort((a, b) => b - a);
  let total = 0;
  let index = 0;

  while (unitPrices.length - index >= 3) {
    total += wiperPairPricing.bundleTotals[3];
    index += 3;
  }

  if (unitPrices.length - index === 2) {
    total += wiperPairPricing.bundleTotals[2];
    index += 2;
  }

  while (index < unitPrices.length) {
    total += unitPrices[index];
    index += 1;
  }

  return roundMoney(total);
}

function getBundleProgressMessage(eligiblePairQuantity: number, bundleDiscount: number, bundleLabel: string) {
  if (eligiblePairQuantity <= 0) return "";
  if (eligiblePairQuantity === 1) return "Add one more front pair to unlock the 2-pair offer.";
  return `${bundleLabel} - saving ${formatPricingMoney(bundleDiscount)}.`;
}

function formatPricingMoney(value: number) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD"
  }).format(value);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
