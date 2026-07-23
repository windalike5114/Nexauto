import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { claimCustomerOrdersForAccount } from "@/lib/application/account/claim-customer-orders";
import { isOrderClaimError } from "@/lib/domain/account/order-claim.errors";
import { createSupabaseAccountOrderRepository } from "@/lib/infrastructure/supabase/account-order.repository";
import { getOrCreateCustomerProfile, listCustomerOrdersForProfile, listCustomerVehicles } from "@/lib/queries/account";
import type { User } from "@supabase/supabase-js";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const profile = await getOrCreateCustomerProfile(user);
    const claimResult = await claimOrdersSafely(user);
    const [vehicles, orders] = await Promise.all([
      listCustomerVehicles(profile.id),
      listCustomerOrdersForProfile(profile.id, profile.email)
    ]);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email
      },
      profile,
      vehicles,
      orders,
      claimResult,
      legacyFallbackUsed: orders.some((order) => order.ownershipSource === "legacy_email"),
      rewards: {
        welcome: {
          amount: 10,
          status: orders.length > 0 ? "used" : "available"
        }
      }
    });
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "Could not load account." },
      { status: 500 }
    );
  }
}

async function claimOrdersSafely(user: User) {
  try {
    return await claimCustomerOrdersForAccount(
      {
        authUserId: user.id,
        verifiedEmail: user.email ?? null,
        emailVerified: Boolean(user.email_confirmed_at ?? user.confirmed_at)
      },
      createSupabaseAccountOrderRepository()
    );
  } catch (error) {
    if (isOrderClaimError(error)) {
      console.error("account.order_claim_skipped", {
        code: error.code,
        authUserId: user.id
      });
      return emptyClaimResult(error.safeMessage);
    }

    console.error("account.order_claim_failed", {
      authUserId: user.id,
      message: error instanceof Error ? error.message : "Unknown order claim error"
    });
    return emptyClaimResult("Order history could not be linked right now.");
  }
}

function emptyClaimResult(warning: string) {
  return {
    claimedCount: 0,
    alreadyOwnedCount: 0,
    conflictCount: 0,
    skippedCount: 0,
    claimedOrderIds: [],
    warning
  };
}
