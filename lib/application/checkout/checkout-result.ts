export type CreateCheckoutResult = {
  checkoutRequestId: string;
  orderId: string;
  orderNumber: string;
  stripeSessionId: string;
  checkoutUrl: string;
};
