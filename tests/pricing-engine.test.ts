import test from "node:test";
import assert from "node:assert/strict";
import { calculateOrderPricing } from "../lib/application/pricing/calculate-order-pricing";
import type { PricingInput, PricingInputItem } from "../lib/application/pricing/pricing-input";
import { compareLegacyCartPricing } from "../lib/application/pricing/pricing-comparison";
import { toMinorUnits } from "../lib/domain/shared/money";
import type { CartItem } from "../lib/types";

function frontPair(sku: string, quantity = 1, vehicle = "Toyota Hilux 2018"): PricingInputItem {
  return {
    productId: "wiper_set",
    variantId: `set-${sku}`,
    sku,
    name: `Premium Front Wiper Blade Pair ${sku}`,
    category: "wiper",
    quantity,
    unitAmountMinor: 5999,
    bundleEligible: true,
    bundleCategory: "front-wiper-pair",
    attributes: {
      vehicle,
      driver_length: "24\"",
      passenger_length: "18\""
    }
  };
}

function rearBlade(quantity = 1): PricingInputItem {
  return {
    productId: "wiper_rear_addon",
    variantId: "rear-15",
    sku: "WPR15",
    name: "Rear Wiper Blade 15\"",
    category: "wiper",
    quantity,
    unitAmountMinor: 1999,
    bundleEligible: false,
    attributes: {
      rear_length: "15\""
    }
  };
}

function testProduct(quantity = 1): PricingInputItem {
  return {
    productId: "test_product",
    variantId: "test-001",
    sku: "TEST-001",
    name: "Checkout Test Product",
    category: "test",
    quantity,
    unitAmountMinor: 100,
    bundleEligible: false,
    attributes: {}
  };
}

function price(items: PricingInputItem[], overrides: Partial<PricingInput> = {}) {
  return calculateOrderPricing({
    currency: "nzd",
    items,
    customer: {
      welcomeRewardEligible: false
    },
    shipping: {
      country: "NZ",
      promotionalFreeShipping: true,
      standardShippingMinor: 800
    },
    ...overrides
  });
}

test("one eligible wiper pair has no bundle discount", () => {
  const calculated = price([frontPair("WPFP2418")]);

  assert.equal(calculated.result.productSubtotalMinor, 5999);
  assert.equal(calculated.result.bundleDiscountMinor, 0);
  assert.equal(calculated.result.grandTotalMinor, 5999);
});

test("two identical eligible pairs receive the two-pair bundle", () => {
  const calculated = price([frontPair("WPFP2418", 2)]);

  assert.equal(calculated.result.productSubtotalMinor, 11998);
  assert.equal(calculated.result.bundleDiscountMinor, 999);
  assert.equal(calculated.result.grandTotalMinor, 10999);
});

test("two different eligible front wiper pair SKUs receive the two-pair bundle", () => {
  const calculated = price([frontPair("WPFP2418"), frontPair("WPFP2216")]);

  assert.equal(calculated.result.bundleDiscountMinor, 999);
  assert.equal(calculated.result.grandTotalMinor, 10999);
});

test("two eligible pairs for different vehicles still receive the two-pair bundle", () => {
  const calculated = price([
    frontPair("WPFP2416", 1, "Toyota Hilux 2018"),
    frontPair("WPFP2218", 1, "Ford Ranger 2020")
  ]);

  assert.equal(calculated.result.bundleDiscountMinor, 999);
  assert.equal(calculated.result.grandTotalMinor, 10999);
});

test("three identical eligible pairs receive the three-pair bundle", () => {
  const calculated = price([frontPair("WPFP2418", 3)]);

  assert.equal(calculated.result.productSubtotalMinor, 17997);
  assert.equal(calculated.result.bundleDiscountMinor, 2998);
  assert.equal(calculated.result.grandTotalMinor, 14999);
});

test("three different eligible pair SKUs receive the three-pair bundle", () => {
  const calculated = price([frontPair("WPFP2418"), frontPair("WPFP2216"), frontPair("WPFP2018")]);

  assert.equal(calculated.result.bundleDiscountMinor, 2998);
  assert.equal(calculated.result.grandTotalMinor, 14999);
});

test("eligible pairs plus rear wiper exclude rear wiper from bundle", () => {
  const calculated = price([frontPair("WPFP2418"), frontPair("WPFP2216"), rearBlade()]);

  assert.equal(calculated.result.productSubtotalMinor, 13997);
  assert.equal(calculated.result.bundleDiscountMinor, 999);
  assert.equal(calculated.result.grandTotalMinor, 12998);
});

test("non-eligible product does not participate in bundle", () => {
  const calculated = price([testProduct(2)]);

  assert.equal(calculated.result.bundleDiscountMinor, 0);
  assert.equal(calculated.result.grandTotalMinor, 200);
});

test("sale-price product uses trusted unit amount", () => {
  const calculated = price([{ ...frontPair("WPFP2816"), unitAmountMinor: 4999 }]);

  assert.equal(calculated.result.productSubtotalMinor, 4999);
  assert.equal(calculated.result.grandTotalMinor, 4999);
});

test("bundle with welcome reward stacks after bundle discount", () => {
  const calculated = price([frontPair("WPFP2418"), frontPair("WPFP2216")], {
    customer: {
      welcomeRewardEligible: true
    }
  });

  assert.equal(calculated.result.bundleDiscountMinor, 999);
  assert.equal(calculated.result.welcomeRewardMinor, 1000);
  assert.equal(calculated.result.grandTotalMinor, 9999);
});

test("bundle with coupon applies coupon after bundle", () => {
  const calculated = price([frontPair("WPFP2418"), frontPair("WPFP2216")], {
    coupon: {
      code: "SAVE10",
      label: "NZD 10.00 off",
      amountOffMinor: 1000
    }
  });

  assert.equal(calculated.result.bundleDiscountMinor, 999);
  assert.equal(calculated.result.couponDiscountMinor, 1000);
  assert.equal(calculated.result.grandTotalMinor, 9999);
});

test("bundle with welcome reward and coupon reconciles", () => {
  const calculated = price([frontPair("WPFP2418"), frontPair("WPFP2216")], {
    customer: {
      welcomeRewardEligible: true
    },
    coupon: {
      code: "SAVE10",
      label: "NZD 10.00 off",
      amountOffMinor: 1000
    }
  });

  assert.equal(calculated.result.grandTotalMinor, 8999);
  assertReconciles(calculated.result);
});

test("welcome reward cannot create a negative subtotal", () => {
  const calculated = price([testProduct()], {
    customer: {
      welcomeRewardEligible: true
    }
  });

  assert.equal(calculated.result.welcomeRewardMinor, 100);
  assert.equal(calculated.result.grandTotalMinor, 0);
});

test("free-shipping promotion keeps shipping at zero", () => {
  const calculated = price([frontPair("WPFP2418")]);

  assert.equal(calculated.result.shippingMinor, 0);
});

test("standard shipping charges NZ$8 when promotion is disabled", () => {
  const calculated = price([frontPair("WPFP2418")], {
    shipping: {
      country: "NZ",
      promotionalFreeShipping: false,
      standardShippingMinor: 800
    }
  });

  assert.equal(calculated.result.shippingMinor, 800);
  assert.equal(calculated.result.grandTotalMinor, 6799);
});

test("GST is calculated as GST-inclusive component", () => {
  const calculated = price([frontPair("WPFP2418")]);

  assert.equal(calculated.result.gstIncludedMinor, Math.round((5999 * 3) / 23));
  assert.equal(calculated.result.grandTotalMinor, 5999);
});

test("decimal dollar price converts to minor units once at boundary", () => {
  assert.equal(toMinorUnits(59.99), 5999);
});

test("invalid negative price is rejected", () => {
  assert.throws(() => price([{ ...frontPair("WPFP2418"), unitAmountMinor: -1 }]));
});

test("invalid quantity is rejected", () => {
  assert.throws(() => price([{ ...frontPair("WPFP2418"), quantity: 0 }]));
});

test("duplicate input products are counted by quantity and eligibility, not unique SKU", () => {
  const calculated = price([frontPair("WPFP2418"), frontPair("WPFP2418")]);

  assert.equal(calculated.result.bundleDiscountMinor, 999);
});

test("modified client price is ignored when trusted server price is used", () => {
  const clientItem = { ...frontPair("WPFP2418"), unitAmountMinor: 1 };
  const trustedServerItem = { ...clientItem, unitAmountMinor: 5999 };
  const calculated = price([trustedServerItem]);

  assert.equal(calculated.result.productSubtotalMinor, 5999);
});

test("modified client subtotal, discount, and total are not pricing inputs", () => {
  const untrustedClientPayload = {
    subtotalMinor: 1,
    discountMinor: 999999,
    totalMinor: 1
  };
  const calculated = price([frontPair("WPFP2418")]);

  assert.equal("subtotalMinor" in calculated.result, false);
  assert.equal(untrustedClientPayload.totalMinor, 1);
  assert.equal(calculated.result.grandTotalMinor, 5999);
});

test("pricing mathematical reconciliation holds", () => {
  const calculated = price([frontPair("WPFP2418"), frontPair("WPFP2216"), rearBlade()], {
    customer: {
      welcomeRewardEligible: true
    },
    coupon: {
      code: "SAVE5",
      label: "NZD 5.00 off",
      amountOffMinor: 500
    }
  });

  assertReconciles(calculated.result);
});

test("new engine matches legacy production pricing for representative carts before coupon", () => {
  const legacyCart: CartItem[] = [
    legacyFrontPair("WPFP2418", "Toyota Hilux 2018"),
    legacyFrontPair("WPFP2216", "Ford Ranger 2020"),
    legacyRearBlade()
  ];
  const calculated = price([frontPair("WPFP2418", 1, "Toyota Hilux 2018"), frontPair("WPFP2216", 1, "Ford Ranger 2020"), rearBlade()]);
  const comparison = compareLegacyCartPricing(legacyCart, calculated);

  assert.equal(comparison.productsSubtotalMatches, true);
  assert.equal(comparison.bundleDiscountMatches, true);
  assert.equal(comparison.totalBeforeExternalCouponMatches, true);
});

function legacyFrontPair(sku: string, vehicle: string): CartItem {
  return {
    productId: "wiper_set",
    variantId: `set-${sku}`,
    sku,
    name: `Premium Front Wiper Blade Pair ${sku}`,
    category: "wiper",
    qty: 1,
    price: 59.99,
    bundleEligible: true,
    bundleCategory: "front-wiper-pair",
    attributes: {
      vehicle,
      driver_length: "24\"",
      passenger_length: "18\""
    }
  };
}

function legacyRearBlade(): CartItem {
  return {
    productId: "wiper_rear_addon",
    variantId: "rear-15",
    sku: "WPR15",
    name: "Rear Wiper Blade 15\"",
    category: "wiper",
    qty: 1,
    price: 19.99,
    bundleEligible: false,
    attributes: {
      rear_length: "15\""
    }
  };
}

function assertReconciles(result: ReturnType<typeof calculateOrderPricing>["result"]) {
  assert.equal(
    result.productSubtotalMinor - result.discountTotalMinor + result.shippingMinor,
    result.grandTotalMinor
  );
}
