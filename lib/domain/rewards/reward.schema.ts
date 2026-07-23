import { z } from "zod";
import { CurrencyCodeSchema, MinorUnitAmountSchema } from "@/lib/domain/shared/money";

export const RewardStatusSchema = z.enum(["available", "reserved", "redeemed", "expired", "cancelled", "used"]);
export const RewardTransactionTypeSchema = z.enum(["grant", "reserve", "release", "redeem", "expire", "adjust"]);

export const RewardAccountSchema = z
  .object({
    id: z.string().trim().min(1),
    userId: z.string().trim().min(1).optional(),
    email: z.string().email(),
    currency: CurrencyCodeSchema,
    balanceMinor: MinorUnitAmountSchema,
    status: RewardStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional()
  })
  .strict();

export const RewardTransactionSchema = z
  .object({
    id: z.string().trim().min(1),
    rewardAccountId: z.string().trim().min(1),
    type: RewardTransactionTypeSchema,
    amountMinor: z.number().int(),
    currency: CurrencyCodeSchema,
    orderId: z.string().trim().min(1).optional(),
    reservationId: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    createdAt: z.string().datetime()
  })
  .strict();

export const RewardReservationSchema = z
  .object({
    id: z.string().trim().min(1),
    rewardAccountId: z.string().trim().min(1),
    orderDraftId: z.string().trim().min(1),
    amountMinor: MinorUnitAmountSchema,
    currency: CurrencyCodeSchema,
    status: z.enum(["active", "released", "redeemed", "expired"]),
    expiresAt: z.string().datetime(),
    createdAt: z.string().datetime()
  })
  .strict();

export const RewardRedemptionSchema = z
  .object({
    id: z.string().trim().min(1),
    rewardAccountId: z.string().trim().min(1),
    reservationId: z.string().trim().min(1).optional(),
    orderId: z.string().trim().min(1),
    amountMinor: MinorUnitAmountSchema,
    currency: CurrencyCodeSchema,
    createdAt: z.string().datetime()
  })
  .strict();
