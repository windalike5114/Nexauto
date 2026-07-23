import type { z } from "zod";
import type {
  FulfilmentStatusSchema,
  RewardStateSchema,
  OrderCustomerSnapshotSchema,
  OrderDraftSchema,
  OrderFitmentSnapshotSchema,
  OrderItemSchema,
  OrderPaymentSnapshotSchema,
  OrderPricingSnapshotSchema,
  OrderProductSnapshotSchema,
  OrderSchema,
  OrderShippingSnapshotSchema,
  OrderStatusSchema,
  OrderVehicleSnapshotSchema,
  PaymentStatusSchema
} from "./order.schema";

export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type FulfilmentStatus = z.infer<typeof FulfilmentStatusSchema>;
export type RewardState = z.infer<typeof RewardStateSchema>;
export type OrderProductSnapshot = z.infer<typeof OrderProductSnapshotSchema>;
export type OrderVehicleSnapshot = z.infer<typeof OrderVehicleSnapshotSchema>;
export type OrderFitmentSnapshot = z.infer<typeof OrderFitmentSnapshotSchema>;
export type OrderCustomerSnapshot = z.infer<typeof OrderCustomerSnapshotSchema>;
export type OrderShippingSnapshot = z.infer<typeof OrderShippingSnapshotSchema>;
export type OrderPaymentSnapshot = z.infer<typeof OrderPaymentSnapshotSchema>;
export type OrderPricingSnapshot = z.infer<typeof OrderPricingSnapshotSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type OrderDraft = z.infer<typeof OrderDraftSchema>;
export type Order = z.infer<typeof OrderSchema>;
