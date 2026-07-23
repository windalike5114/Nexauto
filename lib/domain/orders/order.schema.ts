import { z } from "zod";
import { AttributeRecordSchema, CartVehicleContextSchema, SelectedFitmentSchema } from "@/lib/domain/cart/cart.schema";
import { PricingResultSchema } from "@/lib/domain/pricing/pricing.schema";
import { CurrencyCodeSchema, MinorUnitAmountSchema } from "@/lib/domain/shared/money";

export const CheckoutVersionSchema = z.literal("1E");
export const PricingVersionSchema = z.literal("2026-07-v1");
export const OrderStatusSchema = z.enum(["pending", "paid", "cancelled", "refunded", "failed"]);
export const PaymentStatusSchema = z.enum(["pending", "paid", "failed", "refunded", "requires_action"]);
export const FulfilmentStatusSchema = z.enum(["pending", "adapter_selection", "packed", "shipped", "delivered", "issue"]);
export const RewardStateReasonSchema = z.enum([
  "applied",
  "not_requested",
  "not_authenticated",
  "not_eligible",
  "already_used",
  "minimum_not_met",
  "invalid"
]);

export const RewardStateSchema = z
  .object({
    requested: z.boolean(),
    eligible: z.boolean(),
    applied: z.boolean(),
    amountMinor: MinorUnitAmountSchema,
    reason: RewardStateReasonSchema
  })
  .strict();

export const OrderProductSnapshotSchema = z
  .object({
    productId: z.string().trim().min(1),
    variantId: z.string().trim().min(1),
    sku: z.string().trim().min(1),
    name: z.string().trim().min(1),
    category: z.string().trim().min(1).optional(),
    imageUrl: z.string().optional(),
    attributes: AttributeRecordSchema.default({})
  })
  .strict();

export const OrderVehicleSnapshotSchema = CartVehicleContextSchema.safeExtend({
  applicationId: z.string().trim().min(1).optional()
}).strict();

export const OrderFitmentSnapshotSchema = SelectedFitmentSchema.extend({
  connectorMatchedBy: z.enum(["system", "admin", "unknown"]).default("unknown")
}).strict();

export const OrderCustomerSnapshotSchema = z
  .object({
    userId: z.string().trim().min(1).nullable().optional(),
    email: z.string().email(),
    name: z.string().trim().nullable().optional()
  })
  .strict();

export const AddressSnapshotSchema = z
  .object({
    name: z.string().trim().nullable().optional(),
    line1: z.string().trim().nullable().optional(),
    line2: z.string().trim().nullable().optional(),
    city: z.string().trim().nullable().optional(),
    region: z.string().trim().nullable().optional(),
    postalCode: z.string().trim().nullable().optional(),
    country: z.string().trim().min(2).max(2).optional()
  })
  .strict();

export const OrderShippingSnapshotSchema = z
  .object({
    method: z.string().trim().min(1).optional(),
    amountMinor: MinorUnitAmountSchema.default(0),
    address: AddressSnapshotSchema.optional()
  })
  .strict();

export const OrderPaymentSnapshotSchema = z
  .object({
    provider: z.literal("stripe"),
    sessionId: z.string().trim().min(1).optional(),
    paymentIntentId: z.string().trim().min(1).nullable().optional(),
    invoiceId: z.string().trim().min(1).nullable().optional(),
    invoiceUrl: z.string().url().nullable().optional(),
    status: PaymentStatusSchema
  })
  .strict();

export const OrderPricingSnapshotSchema = PricingResultSchema;

export const OrderItemSchema = z
  .object({
    product: OrderProductSnapshotSchema,
    fitment: OrderFitmentSnapshotSchema.optional(),
    vehicle: OrderVehicleSnapshotSchema.optional(),
    quantity: z.number().int().min(1),
    unitAmountMinor: MinorUnitAmountSchema,
    lineSubtotalMinor: MinorUnitAmountSchema.optional(),
    lineDiscountMinor: MinorUnitAmountSchema.default(0),
    lineTotalMinor: MinorUnitAmountSchema
  })
  .strict();

export const OrderDraftSchema = z
  .object({
    orderNumber: z.string().trim().min(1).optional(),
    checkoutVersion: CheckoutVersionSchema.default("1E"),
    pricingVersion: PricingVersionSchema.default("2026-07-v1"),
    customer: OrderCustomerSnapshotSchema,
    items: z.array(OrderItemSchema).min(1),
    pricing: OrderPricingSnapshotSchema,
    rewardState: RewardStateSchema.optional(),
    vehicle: OrderVehicleSnapshotSchema.optional(),
    shipping: OrderShippingSnapshotSchema.optional(),
    currency: CurrencyCodeSchema,
    status: OrderStatusSchema.default("pending"),
    paymentStatus: PaymentStatusSchema.default("pending"),
    fulfilmentStatus: FulfilmentStatusSchema.default("pending")
  })
  .strict();

export const OrderSchema = OrderDraftSchema.extend({
  id: z.string().trim().min(1),
  orderNumber: z.string().trim().min(1),
  payment: OrderPaymentSnapshotSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
}).strict();
