import { listCustomerOrders } from "@/lib/queries/account";
import type { CheckoutCustomerRepository } from "@/lib/application/checkout/create-checkout-session";

export function createSupabaseCheckoutCustomerRepository(): CheckoutCustomerRepository {
  return {
    async hasExistingOrders(email) {
      const existingOrders = await listCustomerOrders(email);
      return existingOrders.length > 0;
    }
  };
}
