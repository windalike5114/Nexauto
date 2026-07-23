import type { z } from "zod";
import type {
  AttributeRecordSchema,
  AttributeValueSchema,
  CartItemSchema,
  CartProductReferenceSchema,
  CartPromotionInputSchema,
  CartSchema,
  CartVehicleContextSchema,
  SelectedFitmentSchema
} from "./cart.schema";

export type AttributeValue = z.infer<typeof AttributeValueSchema>;
export type AttributeRecord = z.infer<typeof AttributeRecordSchema>;
export type CartProductReference = z.infer<typeof CartProductReferenceSchema>;
export type CartVehicleContext = z.infer<typeof CartVehicleContextSchema>;
export type SelectedFitment = z.infer<typeof SelectedFitmentSchema>;
export type CartPromotionInput = z.infer<typeof CartPromotionInputSchema>;
export type CartItem = z.infer<typeof CartItemSchema>;
export type Cart = z.infer<typeof CartSchema>;
