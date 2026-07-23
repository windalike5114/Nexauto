import { pricingRules } from "@/lib/domain/pricing/pricing.rules";
import type { RewardState } from "./checkout-contract";

export function buildRewardState(input: {
  requested: boolean;
  hasCustomerEmail: boolean;
  eligible: boolean;
  appliedAmountMinor: number;
  subtotalAfterBundleMinor: number;
}): RewardState {
  if (!input.requested) {
    return { requested: false, eligible: false, applied: false, amountMinor: 0, reason: "not_requested" };
  }

  if (!input.hasCustomerEmail) {
    return { requested: true, eligible: false, applied: false, amountMinor: 0, reason: "not_authenticated" };
  }

  if (!input.eligible) {
    return { requested: true, eligible: false, applied: false, amountMinor: 0, reason: "already_used" };
  }

  if (input.subtotalAfterBundleMinor <= 0) {
    return { requested: true, eligible: true, applied: false, amountMinor: 0, reason: "minimum_not_met" };
  }

  const amountMinor = Math.min(pricingRules.welcomeReward.amountMinor, input.appliedAmountMinor, input.subtotalAfterBundleMinor);

  if (amountMinor <= 0) {
    return { requested: true, eligible: true, applied: false, amountMinor: 0, reason: "minimum_not_met" };
  }

  return { requested: true, eligible: true, applied: true, amountMinor, reason: "applied" };
}
