import type { CartItem } from "@/lib/types";

export type CheckoutCustomerContext = {
  email: string | null;
  userId?: string | null;
};

export type CreateCheckoutCommand = {
  checkoutRequestId: string;
  items: CartItem[];
  couponCode?: string;
  welcomeRewardApplied: boolean;
  customer: CheckoutCustomerContext;
  siteUrl: string;
};
