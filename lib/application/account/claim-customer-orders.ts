import type { CustomerOrderClaimRepository } from "@/lib/application/account/customer-order-repository";
import { OrderClaimError } from "@/lib/domain/account/order-claim.errors";
import { isUsableClaimEmail } from "@/lib/domain/account/order-claim.schema";
import type { OrderClaimContext } from "@/lib/domain/account/order-claim.types";

export async function claimCustomerOrdersForAccount(context: OrderClaimContext, repository: CustomerOrderClaimRepository) {
  if (!context.emailVerified || !isUsableClaimEmail(context.verifiedEmail)) {
    throw new OrderClaimError(
      "ORDER_CLAIM_EMAIL_NOT_VERIFIED",
      "Verified account email is required before claiming historical orders.",
      "Verify your email before linking historical orders."
    );
  }

  return repository.claimVerifiedEmailOrders(context);
}
