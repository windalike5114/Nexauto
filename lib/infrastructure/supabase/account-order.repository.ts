import type { CustomerOrderClaimRepository } from "@/lib/application/account/customer-order-repository";
import { OrderClaimError } from "@/lib/domain/account/order-claim.errors";
import { normalizeClaimEmail } from "@/lib/domain/account/order-claim.schema";
import type { OrderClaimContext, OrderClaimResult } from "@/lib/domain/account/order-claim.types";
import { createSupabaseAdminClient } from "@/lib/supabase";

type ClaimRpcRow = {
  claimed_count: number;
  already_owned_count: number;
  conflict_count: number;
  skipped_count: number;
  claimed_order_ids: string[] | null;
};

export function createSupabaseAccountOrderRepository(): CustomerOrderClaimRepository {
  return {
    async claimVerifiedEmailOrders(context: OrderClaimContext) {
      const { data, error } = await getAdmin().rpc("claim_customer_orders_for_verified_user", {
        p_auth_user_id: context.authUserId,
        p_verified_email: normalizeClaimEmail(context.verifiedEmail)
      });

      if (error) throw repositoryError(error);

      const row = (Array.isArray(data) ? data[0] : data) as ClaimRpcRow | null;

      return {
        claimedCount: Number(row?.claimed_count ?? 0),
        alreadyOwnedCount: Number(row?.already_owned_count ?? 0),
        conflictCount: Number(row?.conflict_count ?? 0),
        skippedCount: Number(row?.skipped_count ?? 0),
        claimedOrderIds: row?.claimed_order_ids ?? []
      } satisfies OrderClaimResult;
    }
  };
}

function repositoryError(error: { message?: string }) {
  const message = error.message ?? "";

  if (message.includes("customer_profile_email_mismatch")) {
    return new OrderClaimError("ORDER_CLAIM_EMAIL_MISMATCH", "Verified email does not match the customer profile.");
  }

  if (message.includes("customer_profile_not_found")) {
    return new OrderClaimError("ORDER_CLAIM_PROFILE_MISSING", "Customer profile was not found.");
  }

  if (message.includes("duplicate_customer_profile")) {
    return new OrderClaimError("ORDER_CLAIM_DUPLICATE_PROFILE", "Duplicate customer profiles were found.");
  }

  if (message.includes("verified_email_required") || message.includes("auth_user_required")) {
    return new OrderClaimError("ORDER_CLAIM_EMAIL_NOT_VERIFIED", "Verified account email is required.");
  }

  return new OrderClaimError("ORDER_CLAIM_REPOSITORY_FAILED", "Order claim request failed.");
}

function getAdmin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new OrderClaimError("ORDER_CLAIM_REPOSITORY_FAILED", "Order claim service is not configured.");
  return supabase;
}
