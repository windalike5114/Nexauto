export const wiperPairPricing = {
  compareAtPrice: 79.99,
  salePrice: 59.99,
  memberPrice: 54.99,
  bundleTotals: {
    2: 109.99,
    3: 149.99
  }
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
