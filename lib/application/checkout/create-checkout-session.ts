import { calculateOrderPricing, type CalculatedOrderPricing } from "@/lib/application/pricing/calculate-order-pricing";
import { compareLegacyCartPricing } from "@/lib/application/pricing/pricing-comparison";
import type { CouponBenefit, PricingInputItem } from "@/lib/application/pricing/pricing-input";
import { fromMinorUnits, toMinorUnits } from "@/lib/domain/shared/money";
import type { CartItem } from "@/lib/types";
import { CHECKOUT_CONTRACT_VERSION, PRICING_VERSION, type RewardState } from "./checkout-contract";
import type { CreateCheckoutCommand } from "./checkout-command";
import type { CreateCheckoutResult } from "./checkout-result";
import {
  CheckoutPersistenceError,
  CouponInvalidError,
  OrderCreationError,
  PaymentSessionCreationError,
  PricingFailedError,
  ProductUnavailableError
} from "./checkout.errors";
import { buildRewardState } from "./reward-state";
import { normalizeVehicleContext, toLegacyVehicleSnapshot } from "./vehicle-context";

export type TrustedCheckoutItem = {
  cartItem: CartItem;
  id: string;
  productId: string;
  sku: string;
  name: string;
  price: number;
  checkoutQuantity?: number;
  checkoutLineTotal?: number;
  bundleDiscount?: number;
  attributes: Record<string, string | number>;
};

export type TrustedCartItem = CartItem;

export type CheckoutProductRepository = {
  loadTrustedCartItems(items: CartItem[]): Promise<TrustedCartItem[]>;
};

export type CheckoutCustomerRepository = {
  hasExistingOrders(email: string): Promise<boolean>;
};

export type CheckoutOrderRepository = {
  createPendingOrder(input: PendingCheckoutOrderInput): Promise<{ id: string; orderNumber: string }>;
  attachStripeSession(orderId: string, stripeSessionId: string): Promise<void>;
  markCheckoutSessionFailed(orderId: string, reason: string): Promise<void>;
};

export type CheckoutCouponAdapter = {
  resolveCoupon(code: string): Promise<CouponBenefit | null>;
};

export type CheckoutPaymentAdapter = {
  createCheckoutSession(input: StripeCheckoutSessionAdapterInput): Promise<{ sessionId: string; checkoutUrl: string }>;
};

export type CheckoutLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

export type CheckoutServiceDependencies = {
  products: CheckoutProductRepository;
  customers: CheckoutCustomerRepository;
  orders: CheckoutOrderRepository;
  coupons: CheckoutCouponAdapter;
  payments: CheckoutPaymentAdapter;
  logger?: CheckoutLogger;
};

export type PendingCheckoutOrderInput = {
  checkoutRequestId: string;
  items: TrustedCheckoutItem[];
  customerEmail: string | null;
  vehicle: ReturnType<typeof buildVehicleMetadata>;
  currency: "nzd";
  pricing: {
    checkoutVersion: string;
    pricingVersion: string;
    productsSubtotal: number;
    merchandiseSubtotal: number;
    bundleDiscount: number;
    welcomeRewardDiscount: number;
    rewardDiscount: number;
    couponDiscount: number;
    shipping: number;
    shippingAmount: number;
    gstIncluded: number;
    taxAmount: number;
    finalSubtotal: number;
    total: number;
    couponCode: string | null;
  };
  rewardState: RewardState;
};

export type StripeCheckoutSessionAdapterInput = {
  checkoutRequestId: string;
  orderId: string;
  orderNumber: string;
  siteUrl: string;
  customerEmail: string | null;
  items: TrustedCheckoutItem[];
  vehicle: ReturnType<typeof buildVehicleMetadata>;
  pricing: CalculatedOrderPricing["result"];
  couponCode: string | null;
};

export async function createCheckoutSession(command: CreateCheckoutCommand, dependencies: CheckoutServiceDependencies): Promise<CreateCheckoutResult> {
  const logger = dependencies.logger ?? console;
  const logContext = { checkoutRequestId: command.checkoutRequestId, customerEmail: command.customer.email ?? undefined };

  if (!command.items.length) {
    throw new ProductUnavailableError("Cart is empty.", logContext);
  }

  logger.info("checkout.started", logContext);

  const trustedCartItems = await loadTrustedCartItems(dependencies.products, command.items, logContext);
  const couponBenefit = await resolveCoupon(command.couponCode, dependencies.coupons, logContext);
  const welcomeRewardEligible = command.welcomeRewardApplied && command.customer.email
    ? !(await dependencies.customers.hasExistingOrders(command.customer.email))
    : false;
  const calculatedPricing = calculateTrustedPricing({
    checkoutRequestId: command.checkoutRequestId,
    trustedCartItems,
    couponBenefit,
    welcomeRewardEligible,
    logger
  });
  const trustedCheckoutItems = buildTrustedCheckoutItems(trustedCartItems, calculatedPricing);
  const vehicle = buildVehicleMetadata(trustedCheckoutItems);
  const pricing = calculatedPricing.result;
  const subtotalAfterBundleMinor = pricing.productSubtotalMinor - pricing.bundleDiscountMinor;
  const rewardState = buildRewardState({
    requested: command.welcomeRewardApplied,
    hasCustomerEmail: Boolean(command.customer.email),
    eligible: welcomeRewardEligible,
    appliedAmountMinor: pricing.welcomeRewardMinor,
    subtotalAfterBundleMinor
  });
  const pendingOrderInput: PendingCheckoutOrderInput = {
    checkoutRequestId: command.checkoutRequestId,
    items: trustedCheckoutItems,
    customerEmail: command.customer.email,
    vehicle,
    currency: "nzd",
    pricing: {
      checkoutVersion: CHECKOUT_CONTRACT_VERSION,
      pricingVersion: PRICING_VERSION,
      productsSubtotal: fromMinorUnits(pricing.productSubtotalMinor),
      merchandiseSubtotal: fromMinorUnits(pricing.productSubtotalMinor),
      bundleDiscount: fromMinorUnits(pricing.bundleDiscountMinor),
      welcomeRewardDiscount: fromMinorUnits(pricing.welcomeRewardMinor),
      rewardDiscount: fromMinorUnits(pricing.welcomeRewardMinor),
      couponDiscount: fromMinorUnits(pricing.couponDiscountMinor),
      shipping: fromMinorUnits(pricing.shippingMinor),
      shippingAmount: fromMinorUnits(pricing.shippingMinor),
      gstIncluded: fromMinorUnits(pricing.gstIncludedMinor),
      taxAmount: fromMinorUnits(pricing.gstIncludedMinor),
      finalSubtotal: fromMinorUnits(pricing.grandTotalMinor),
      total: fromMinorUnits(pricing.grandTotalMinor),
      couponCode: couponBenefit?.code ?? command.couponCode ?? null
    },
    rewardState
  };
  const pendingOrder = await createPendingOrder(dependencies.orders, pendingOrderInput, logger);

  let stripeSession: { sessionId: string; checkoutUrl: string };

  try {
    stripeSession = await dependencies.payments.createCheckoutSession({
      checkoutRequestId: command.checkoutRequestId,
      orderId: pendingOrder.id,
      orderNumber: pendingOrder.orderNumber,
      siteUrl: command.siteUrl,
      customerEmail: command.customer.email,
      items: trustedCheckoutItems,
      vehicle,
      pricing,
      couponCode: couponBenefit?.code ?? command.couponCode ?? null
    });
  } catch (error) {
    await dependencies.orders.markCheckoutSessionFailed(pendingOrder.id, "stripe_session_creation_failed");
    logger.error("checkout.stripe_session_failed", { ...logContext, orderId: pendingOrder.id, error: getErrorMessage(error) });
    throw new PaymentSessionCreationError("Stripe checkout session creation failed.", { ...logContext, orderId: pendingOrder.id });
  }

  try {
    await dependencies.orders.attachStripeSession(pendingOrder.id, stripeSession.sessionId);
  } catch (error) {
    logger.error("checkout.attach_session_failed", {
      ...logContext,
      orderId: pendingOrder.id,
      stripeSessionId: stripeSession.sessionId,
      error: getErrorMessage(error)
    });
    throw new CheckoutPersistenceError("Could not attach Stripe session to pending order.", {
      ...logContext,
      orderId: pendingOrder.id,
      stripeSessionId: stripeSession.sessionId
    });
  }

  logger.info("checkout.completed", {
    ...logContext,
    orderId: pendingOrder.id,
    orderNumber: pendingOrder.orderNumber,
    stripeSessionId: stripeSession.sessionId
  });

  return {
    checkoutRequestId: command.checkoutRequestId,
    orderId: pendingOrder.id,
    orderNumber: pendingOrder.orderNumber,
    stripeSessionId: stripeSession.sessionId,
    checkoutUrl: stripeSession.checkoutUrl
  };
}

async function resolveCoupon(code: string | undefined, coupons: CheckoutCouponAdapter, context: Record<string, unknown>) {
  if (!code) return undefined;
  const coupon = await coupons.resolveCoupon(code);

  if (!coupon) {
    throw new CouponInvalidError("Coupon code is not valid or has expired.", context);
  }

  return coupon;
}

async function loadTrustedCartItems(products: CheckoutProductRepository, items: CartItem[], context: Record<string, unknown>) {
  try {
    return await products.loadTrustedCartItems(items);
  } catch (error) {
    if (error instanceof ProductUnavailableError) throw error;
    throw new ProductUnavailableError("One or more cart items are no longer available.", {
      ...context,
      error: getErrorMessage(error)
    });
  }
}

function calculateTrustedPricing({
  checkoutRequestId,
  trustedCartItems,
  couponBenefit,
  welcomeRewardEligible,
  logger
}: {
  checkoutRequestId: string;
  trustedCartItems: TrustedCartItem[];
  couponBenefit?: CouponBenefit;
  welcomeRewardEligible: boolean;
  logger: CheckoutLogger;
}) {
  try {
    const pricingInputItems = trustedCartItems.map((item): PricingInputItem => ({
      lineId: item.lineId,
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      name: item.name,
      category: item.category,
      quantity: item.qty,
      unitAmountMinor: toMinorUnits(item.price),
      bundleEligible: item.bundleEligible ?? false,
      bundleCategory: item.bundleCategory,
      attributes: item.attributes
    }));
    const calculatedPricing = calculateOrderPricing({
      currency: "nzd",
      items: pricingInputItems,
      customer: { welcomeRewardEligible },
      coupon: couponBenefit,
      shipping: {
        country: "NZ",
        promotionalFreeShipping: true,
        standardShippingMinor: 800
      }
    });
    const comparison = compareLegacyCartPricing(trustedCartItems, calculatedPricing, fromMinorUnits(calculatedPricing.result.welcomeRewardMinor));

    if (!comparison.productsSubtotalMatches || !comparison.bundleDiscountMatches) {
      logger.error("checkout.pricing_comparison_mismatch", { checkoutRequestId, comparison });
    }

    return calculatedPricing;
  } catch (error) {
    throw new PricingFailedError(getErrorMessage(error), { checkoutRequestId });
  }
}

function buildTrustedCheckoutItems(items: TrustedCartItem[], pricing: CalculatedOrderPricing): TrustedCheckoutItem[] {
  return items.map((cartItem, index) => {
    const pricedLine = pricing.lines[index];
    return {
      cartItem,
      id: cartItem.variantId,
      productId: cartItem.productId,
      sku: cartItem.sku,
      name: cartItem.name,
      price: cartItem.price,
      checkoutQuantity: 1,
      checkoutLineTotal: fromMinorUnits(pricedLine.totalMinor),
      bundleDiscount: fromMinorUnits(pricedLine.bundleDiscountMinor),
      attributes: {
        ...cartItem.attributes,
        ...(pricedLine.welcomeRewardMinor > 0 ? { welcome_reward_discount: fromMinorUnits(pricedLine.welcomeRewardMinor) } : {}),
        ...(pricedLine.couponDiscountMinor > 0 ? { coupon_discount: fromMinorUnits(pricedLine.couponDiscountMinor) } : {})
      }
    };
  });
}

async function createPendingOrder(orders: CheckoutOrderRepository, input: PendingCheckoutOrderInput, logger: CheckoutLogger) {
  try {
    return await orders.createPendingOrder(input);
  } catch (error) {
    logger.error("checkout.pending_order_failed", { checkoutRequestId: input.checkoutRequestId, error: getErrorMessage(error) });
    throw new OrderCreationError("Pending order creation failed.", { checkoutRequestId: input.checkoutRequestId });
  }
}

export function buildVehicleMetadata(items: TrustedCheckoutItem[]) {
  const attributes = items.map((item) => item.attributes).find((entry) => entry.vehicle_application_id || entry.vehicle_make || entry.vehicle_model || entry.vehicle_year || entry.vehicle);

  return toLegacyVehicleSnapshot(normalizeVehicleContext(attributes));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
