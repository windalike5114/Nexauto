export const CHECKOUT_CONTRACT_VERSION = "1E";
export const PRICING_VERSION = "2026-07-v1";

export type RewardStateReason =
  | "applied"
  | "not_requested"
  | "not_authenticated"
  | "not_eligible"
  | "already_used"
  | "minimum_not_met"
  | "invalid";

export type RewardState = {
  requested: boolean;
  eligible: boolean;
  applied: boolean;
  amountMinor: number;
  reason: RewardStateReason;
};
