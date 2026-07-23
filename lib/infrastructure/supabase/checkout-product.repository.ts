import { getVariantsByIds } from "@/lib/queries/catalog";
import { getWiperRearAddonsByIds, getWiperSetsByIds } from "@/lib/queries/wiper-commerce";
import type { CheckoutProductRepository, TrustedCartItem } from "@/lib/application/checkout/create-checkout-session";
import { ProductUnavailableError } from "@/lib/application/checkout/checkout.errors";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { isLooseUuid } from "@/lib/domain/shared/uuid";
import type { CartItem } from "@/lib/types";

export function createSupabaseCheckoutProductRepository(): CheckoutProductRepository {
  return {
    async loadTrustedCartItems(items) {
      const standardItems = items.filter((item) => item.productId !== "wiper_set" && item.productId !== "wiper_rear_addon" && item.productId !== "test_product");
      const wiperSetItems = items.filter((item) => item.productId === "wiper_set");
      const rearAddonItems = items.filter((item) => item.productId === "wiper_rear_addon");
      await validateVehicleApplicationReferences(items);
      const requestedVariantIds = [...new Set(standardItems.map((item) => item.variantId))];
      const requestedWiperSetIds = [...new Set(wiperSetItems.map((item) => item.variantId))];
      const requestedRearAddonIds = [...new Set(rearAddonItems.map((item) => item.variantId))];
      const [dbVariants, dbWiperSets, dbRearAddons] = await Promise.all([
        getVariantsByIds(requestedVariantIds),
        getWiperSetsByIds(requestedWiperSetIds),
        getWiperRearAddonsByIds(requestedRearAddonIds)
      ]);

      if (dbVariants.length !== requestedVariantIds.length) {
        throw new ProductUnavailableError("One or more cart items are no longer available.");
      }

      if (dbWiperSets.length !== requestedWiperSetIds.length || dbRearAddons.length !== requestedRearAddonIds.length) {
        throw new ProductUnavailableError("One or more wiper kit items are no longer available.");
      }

      const variantsById = new Map(dbVariants.map((variant) => [variant.id, variant]));
      const wiperSetsById = new Map(dbWiperSets.map((wiperSet) => [wiperSet.id, wiperSet]));
      const rearAddonsById = new Map(dbRearAddons.map((rearAddon) => [rearAddon.id, rearAddon]));

      return items.map((cartItem): TrustedCartItem => {
        const variant = variantsById.get(cartItem.variantId);
        const wiperSet = wiperSetsById.get(cartItem.variantId);
        const rearAddon = rearAddonsById.get(cartItem.variantId);

        if (cartItem.productId === "test_product") {
          return {
            ...cartItem,
            name: "NexAutoParts Checkout Test Product",
            sku: "TEST-001",
            price: 1,
            bundleEligible: false,
            attributes: {
              ...cartItem.attributes,
              test_product: "true"
            }
          };
        }

        if (cartItem.productId !== "wiper_set" && cartItem.productId !== "wiper_rear_addon") {
          if (!variant) throw new ProductUnavailableError(`Cart item missing for variant ${cartItem.variantId}`);
          if (variant.stock < cartItem.qty) {
            throw new ProductUnavailableError(`Not enough stock for ${variant.sku}`);
          }

          return {
            ...cartItem,
            name: getProductName(variant.products) ?? cartItem.name,
            sku: variant.sku,
            price: Number(variant.price),
            attributes: sanitizeAttributes(variant.attributes),
            bundleEligible: false
          };
        }

        if (cartItem.productId === "wiper_set") {
          if (!wiperSet) throw new ProductUnavailableError(`Cart item missing for wiper set ${cartItem.variantId}`);

          return {
            ...cartItem,
            name: wiperSet.name,
            sku: wiperSet.sku,
            price: wiperSet.price,
            bundleEligible: true,
            bundleCategory: "front-wiper-pair",
            attributes: {
              ...cartItem.attributes,
              driver_length: `${wiperSet.driverLengthIn}"`,
              passenger_length: `${wiperSet.passengerLengthIn}"`
            }
          };
        }

        if (!rearAddon) throw new ProductUnavailableError(`Cart item missing for rear add-on ${cartItem.variantId}`);

        return {
          ...cartItem,
          name: rearAddon.name,
          sku: `WPR${rearAddon.rearLengthIn}`,
          price: rearAddon.price,
          bundleEligible: false,
          attributes: {
            ...cartItem.attributes,
            rear_length: `${rearAddon.rearLengthIn}"`
          }
        };
      });
    }
  };
}

async function validateVehicleApplicationReferences(items: CartItem[]) {
  const ids = [
    ...new Set(
      items
        .map((item) => item.attributes.vehicle_application_id)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  ];

  if (!ids.length) return;
  if (ids.some((id) => !isLooseUuid(id))) {
    throw new ProductUnavailableError("Vehicle fitment reference is invalid.");
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new ProductUnavailableError("Vehicle fitment could not be verified.");
  const { data, error } = await supabase.from("vehicle_applications").select("id").in("id", ids);

  if (error) throw error;
  if ((data ?? []).length !== ids.length) {
    throw new ProductUnavailableError("Vehicle fitment reference is no longer available.");
  }
}

function getProductName(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) return getProductName(value[0]);
  if (typeof value === "object" && "name" in value) {
    return String((value as { name: string }).name);
  }
  return null;
}

function sanitizeAttributes(attributes: CartItem["attributes"] | unknown): CartItem["attributes"] {
  if (!attributes || typeof attributes !== "object") return {};
  return attributes as CartItem["attributes"];
}
