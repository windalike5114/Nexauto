export type CheckoutErrorCode =
  | "CHECKOUT_VALIDATION_ERROR"
  | "PRODUCT_UNAVAILABLE"
  | "PRICING_FAILED"
  | "COUPON_INVALID"
  | "ORDER_CREATION_FAILED"
  | "PAYMENT_SESSION_CREATION_FAILED"
  | "CHECKOUT_PERSISTENCE_FAILED";

export class CheckoutApplicationError extends Error {
  constructor(
    public readonly code: CheckoutErrorCode,
    message: string,
    public readonly safeMessage: string,
    public readonly status: number,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "CheckoutApplicationError";
  }
}

export class CheckoutValidationError extends CheckoutApplicationError {
  constructor(message = "Checkout request is invalid.", context: Record<string, unknown> = {}) {
    super("CHECKOUT_VALIDATION_ERROR", message, "Checkout request is invalid.", 400, context);
  }
}

export class ProductUnavailableError extends CheckoutApplicationError {
  constructor(message = "One or more cart items are no longer available.", context: Record<string, unknown> = {}) {
    super("PRODUCT_UNAVAILABLE", message, "One or more cart items are no longer available.", 409, context);
  }
}

export class PricingFailedError extends CheckoutApplicationError {
  constructor(message = "Pricing failed.", context: Record<string, unknown> = {}) {
    super("PRICING_FAILED", message, "Order pricing could not be calculated.", 409, context);
  }
}

export class CouponInvalidError extends CheckoutApplicationError {
  constructor(message = "Coupon code is not valid or has expired.", context: Record<string, unknown> = {}) {
    super("COUPON_INVALID", message, "Coupon code is not valid or has expired.", 400, context);
  }
}

export class OrderCreationError extends CheckoutApplicationError {
  constructor(message = "Pending order creation failed.", context: Record<string, unknown> = {}) {
    super("ORDER_CREATION_FAILED", message, "Checkout could not be started.", 500, context);
  }
}

export class PaymentSessionCreationError extends CheckoutApplicationError {
  constructor(message = "Stripe checkout session creation failed.", context: Record<string, unknown> = {}) {
    super("PAYMENT_SESSION_CREATION_FAILED", message, "Payment session could not be created.", 502, context);
  }
}

export class CheckoutPersistenceError extends CheckoutApplicationError {
  constructor(message = "Checkout persistence failed.", context: Record<string, unknown> = {}) {
    super("CHECKOUT_PERSISTENCE_FAILED", message, "Checkout could not be finalized.", 500, context);
  }
}

export function isCheckoutApplicationError(error: unknown): error is CheckoutApplicationError {
  return error instanceof CheckoutApplicationError;
}
