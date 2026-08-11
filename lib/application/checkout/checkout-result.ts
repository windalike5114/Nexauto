export type CreateCheckoutResult = {
  checkoutRequestId: string;
  orderId: string;
  orderNumber: string | null;
  stripeSessionId: string;
  checkoutUrl: string;
};
