import type { OrderClaimContext, OrderClaimResult } from "@/lib/domain/account/order-claim.types";

export type CustomerOrderClaimRepository = {
  claimVerifiedEmailOrders(context: OrderClaimContext): Promise<OrderClaimResult>;
};
