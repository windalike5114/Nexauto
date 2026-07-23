import type { z } from "zod";
import type {
  RewardAccountSchema,
  RewardRedemptionSchema,
  RewardReservationSchema,
  RewardStatusSchema,
  RewardTransactionSchema,
  RewardTransactionTypeSchema
} from "./reward.schema";

export type RewardStatus = z.infer<typeof RewardStatusSchema>;
export type RewardTransactionType = z.infer<typeof RewardTransactionTypeSchema>;
export type RewardAccount = z.infer<typeof RewardAccountSchema>;
export type RewardTransaction = z.infer<typeof RewardTransactionSchema>;
export type RewardReservation = z.infer<typeof RewardReservationSchema>;
export type RewardRedemption = z.infer<typeof RewardRedemptionSchema>;
