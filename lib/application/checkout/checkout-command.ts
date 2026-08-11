import type { CartItem } from "@/lib/types";
import type { CheckoutShippingAddress } from "@/lib/domain/checkout/shipping-address";

export type CheckoutCustomerContext = {
  email: string | null;
  userId?: string | null;
};

export type CreateCheckoutCommand = {
  checkoutRequestId: string;
  items: CartItem[];
  shippingAddress: CheckoutShippingAddress;
  couponCode?: string;
  welcomeRewardApplied: boolean;
  customer: CheckoutCustomerContext;
  siteUrl: string;
};
