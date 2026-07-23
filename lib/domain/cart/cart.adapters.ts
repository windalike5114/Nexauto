import { z } from "zod";
import type { CartItem as LegacyCartItem } from "@/lib/types";
import { isLooseUuid } from "@/lib/domain/shared/uuid";
import { AttributeRecordSchema, AttributeValueSchema, CartItemSchema, CartVehicleContextSchema } from "./cart.schema";
import type { Cart, CartItem } from "./cart.types";

export const LegacyCartItemSchema = z
  .object({
    lineId: z.string().optional(),
    productId: z.string().trim().min(1),
    variantId: z.string().trim().min(1),
    sku: z.string().trim().min(1),
    name: z.string(),
    category: z.string(),
    qty: z.number().int().min(1).max(99),
    price: z.number().finite().nonnegative(),
    imageUrl: z.string().optional(),
    bundleEligible: z.boolean().optional(),
    bundleCategory: z.string().optional(),
    attributes: AttributeRecordSchema.default({})
  })
  .passthrough();

export const LegacyCheckoutPayloadSchema = z
  .object({
    items: z.array(LegacyCartItemSchema).min(1),
    couponCode: z.string().trim().min(1).max(64).optional(),
    welcomeRewardApplied: z.boolean().optional()
  })
  .passthrough();

export type LegacyCheckoutPayload = z.infer<typeof LegacyCheckoutPayloadSchema>;

export function adaptLegacyCartItemToCanonical(item: z.infer<typeof LegacyCartItemSchema>): CartItem {
  return CartItemSchema.parse({
    product: {
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      category: item.category
    },
    quantity: item.qty,
    vehicle: extractVehicleContext(item.attributes),
    selectedFitment: extractFitment(item.attributes),
    attributes: item.attributes
  });
}

export function adaptLegacyCheckoutPayload(payload: LegacyCheckoutPayload): {
  cart: Cart;
  legacyItems: LegacyCartItem[];
  couponCode?: string;
  welcomeRewardApplied: boolean;
} {
  const canonicalItems = payload.items.map(adaptLegacyCartItemToCanonical);

  return {
    cart: {
      items: canonicalItems,
      promotion: {
        couponCode: payload.couponCode,
        welcomeRewardRequested: payload.welcomeRewardApplied
      }
    },
    legacyItems: payload.items.map((item) => item as LegacyCartItem),
    couponCode: payload.couponCode,
    welcomeRewardApplied: payload.welcomeRewardApplied ?? false
  };
}

function extractVehicleContext(attributes: z.infer<typeof AttributeRecordSchema>) {
  const applicationId = asString(attributes.vehicle_application_id);
  const make = asString(attributes.vehicle_make);
  const model = asString(attributes.vehicle_model);
  const year = attributes.vehicle_year;
  const label = asString(attributes.vehicle);
  const hasStructuredVehicle = Boolean(applicationId || make || model || year);

  if (!hasStructuredVehicle) {
    return label ? CartVehicleContextSchema.parse({ label }) : undefined;
  }

  if (applicationId && !isLooseUuid(applicationId)) {
    throw new Error("Vehicle application id is invalid.");
  }

  return CartVehicleContextSchema.parse({
    applicationId,
    make,
    model,
    year,
    label
  });
}

function extractFitment(attributes: z.infer<typeof AttributeRecordSchema>) {
  const driverLengthIn = parseLengthIn(attributes.driver_length);
  const passengerLengthIn = parseLengthIn(attributes.passenger_length);
  const rearLengthIn = parseLengthIn(attributes.rear_length);
  const connectorCode = asString(attributes.connector_code ?? attributes.connector);

  if (!driverLengthIn && !passengerLengthIn && !rearLengthIn && !connectorCode) return undefined;

  return {
    driverLengthIn,
    passengerLengthIn,
    rearLengthIn,
    connectorCode
  };
}

function parseLengthIn(value: z.infer<typeof AttributeValueSchema> | undefined) {
  if (value === undefined || typeof value === "boolean") return undefined;
  const parsed = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function asString(value: z.infer<typeof AttributeValueSchema> | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
