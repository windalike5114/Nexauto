import { getVariantsByIds } from "@/lib/queries/catalog";
import { getBrakePadBySlugOrPartNumber } from "@/lib/queries/brake-pad-catalog";
import { getOilFilterBySku } from "@/lib/queries/oil-filter-catalog";
import { resolveTrustedBulbCartItem } from "@/lib/bulbs";
import { getBulbCheckoutVariantsBySkus } from "@/lib/queries/bulb-catalog";
import { getWiperRearAddonsByIds, getWiperSetsByIds } from "@/lib/queries/wiper-commerce";
import type { CheckoutProductRepository, TrustedCartItem } from "@/lib/application/checkout/create-checkout-session";
import { ProductUnavailableError } from "@/lib/application/checkout/checkout.errors";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { isLooseUuid } from "@/lib/domain/shared/uuid";
import { isVehicleCatalogApplicationId } from "@/lib/domain/shared/vehicle-catalog-id";
import type { CartItem } from "@/lib/types";
import { resolveVehicleSelection } from '@/lib/server/resolve-vehicle-selection';
import { loadStorefrontCatalogue, matchStorefrontCatalogue } from '@/lib/queries/storefront-catalog';
import { validateCatalogueSelections } from '@/lib/application/checkout/catalogue-selection';

export function createSupabaseCheckoutProductRepository(): CheckoutProductRepository {
  return {
    async loadTrustedCartItems(items) {
      const testItems = items.filter((item) => item.productId === "test_product");
      if (testItems.length && !isCheckoutTestProductEnabled()) {
        throw new ProductUnavailableError("Checkout test products are disabled.");
      }
      const standardItems = items.filter((item) => item.productId !== "wiper_set" && item.productId !== "wiper_rear_addon" && item.productId !== "brake_pad" && item.productId !== "oil_filter" && item.productId !== "bulb" && item.productId !== "test_product");
      const wiperSetItems = items.filter((item) => item.productId === "wiper_set");
      const rearAddonItems = items.filter((item) => item.productId === "wiper_rear_addon");
      const brakePadItems = items.filter((item) => item.productId === "brake_pad");
      const oilFilterItems = items.filter((item) => item.productId === "oil_filter");
      const legacyBulbSkus = [...new Set(items.filter((item) => item.productId === "bulb").map((item) => item.variantId))];
      await validateVehicleApplicationReferences(items);
      const requestedVariantIds = [...new Set(standardItems.map((item) => item.variantId))];
      const requestedWiperSetIds = [...new Set(wiperSetItems.map((item) => item.variantId))];
      const requestedRearAddonIds = [...new Set(rearAddonItems.map((item) => item.variantId))];
      const requestedBrakePadSkus = [...new Set(brakePadItems.map((item) => item.variantId))];
      const requestedOilFilterSkus = [...new Set(oilFilterItems.map((item) => item.variantId))];
      const [dbVariants, dbWiperSets, dbRearAddons, brakePads, oilFilters, legacyBulbs] = await Promise.all([
        getVariantsByIds(requestedVariantIds),
        getWiperSetsByIds(requestedWiperSetIds),
        getWiperRearAddonsByIds(requestedRearAddonIds),
        Promise.all(requestedBrakePadSkus.map((sku) => getBrakePadBySlugOrPartNumber(sku))),
        Promise.all(requestedOilFilterSkus.map((sku) => getOilFilterBySku(sku))),
        getBulbCheckoutVariantsBySkus(legacyBulbSkus)
      ]);

      if (dbVariants.length !== requestedVariantIds.length) {
        throw new ProductUnavailableError("One or more cart items are no longer available.");
      }

      if (dbWiperSets.length !== requestedWiperSetIds.length || dbRearAddons.length !== requestedRearAddonIds.length) {
        throw new ProductUnavailableError("One or more wiper kit items are no longer available.");
      }
      if (brakePads.some((brakePad) => !brakePad)) {
        throw new ProductUnavailableError("One or more brake pad items are no longer available.");
      }
      if (oilFilters.some((oilFilter) => !oilFilter)) {
        throw new ProductUnavailableError("One or more oil filter items are no longer available.");
      }

      const variantsById = new Map(dbVariants.map((variant) => [variant.id, variant]));
      const wiperSetsById = new Map(dbWiperSets.map((wiperSet) => [wiperSet.id, wiperSet]));
      const rearAddonsById = new Map(dbRearAddons.map((rearAddon) => [rearAddon.id, rearAddon]));
      const brakePadsBySku = new Map(brakePads.flatMap((brakePad) => brakePad ? [[brakePad.partNumber, brakePad] as const] : []));
      const oilFiltersBySku = new Map(oilFilters.flatMap((oilFilter) => oilFilter ? [[oilFilter.partNumber, oilFilter] as const] : []));

      const trustedItems = items.map((cartItem): TrustedCartItem => {
        if (cartItem.productId === "bulb") {
          const variant = legacyBulbs.find((entry) => entry.sku === cartItem.variantId);
          const bulb = variant ? resolveTrustedBulbCartItem(cartItem, variant) : null;
          if (!bulb) throw new ProductUnavailableError(`Bulb ${cartItem.variantId} is no longer available.`);
          return bulb;
        }
        const variant = variantsById.get(cartItem.variantId);
        const wiperSet = wiperSetsById.get(cartItem.variantId);
        const rearAddon = rearAddonsById.get(cartItem.variantId);
        const brakePad = brakePadsBySku.get(cartItem.variantId);
        const oilFilter = oilFiltersBySku.get(cartItem.variantId);

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

        if (cartItem.productId === "brake_pad") {
          if (!brakePad) throw new ProductUnavailableError(`Cart item missing for brake pad ${cartItem.variantId}`);

          return {
            ...cartItem,
            name: brakePad.title,
            sku: brakePad.partNumber,
            price: Number(brakePad.variant.price),
            bundleEligible: false,
            attributes: {
              supplier_ref: brakePad.supplierRef,
              position: brakePad.packDescription,
              length_mm: brakePad.lengthMm ?? "",
              width_mm: brakePad.widthMm ?? "",
              thickness_mm: brakePad.thicknessMm ?? ""
            }
          };
        }

        if (cartItem.productId === "oil_filter") {
          if (!oilFilter) throw new ProductUnavailableError(`Cart item missing for oil filter ${cartItem.variantId}`);

          return {
            ...cartItem,
            name: oilFilter.title,
            sku: oilFilter.partNumber,
            price: Number(oilFilter.variant.price),
            bundleEligible: false,
            attributes: {
              supplier_ref: oilFilter.supplierRef,
              filter_type: oilFilter.construction,
              height_mm: oilFilter.heightMm ?? "",
              outside_diameter_mm: oilFilter.outsideDiameter ?? "",
              inside_diameter: oilFilter.insideDiameter ?? "",
              thread_size: oilFilter.threadSize ?? "",
              seal_ring_size: oilFilter.sealRingSize ?? ""
            }
          };
        }

        if (cartItem.productId !== "wiper_set" && cartItem.productId !== "wiper_rear_addon") {
          if (!variant) throw new ProductUnavailableError(`Cart item missing for variant ${cartItem.variantId}`);
          if (variant.category_slug === "bulb" && /^NBL\d{4}$/.test(variant.sku)) {
            const bulb = resolveTrustedBulbCartItem(cartItem, variant);
            if (!bulb) throw new ProductUnavailableError(`Bulb ${variant.sku} is no longer available in the requested quantity.`);
            return bulb;
          }
          if (variant.stock < cartItem.qty) {
            throw new ProductUnavailableError(`Not enough stock for ${variant.sku}`);
          }

          return {
            ...cartItem,
            name: variant.product_name || cartItem.name,
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
      const vehicleAttributes = await validateCatalogueSelections(trustedItems.map((item,index)=>({ ...item, attributes:{ ...item.attributes, ...(typeof items[index].attributes.vehicle_selection==='string'?{vehicle_selection:items[index].attributes.vehicle_selection}:{}) } })),async context=>{
        const resolved=await resolveVehicleSelection(context);if(!resolved)return null;
        return {vehicle:resolved.vehicle,entries:await matchStorefrontCatalogue(await loadStorefrontCatalogue(),resolved.vehicle,resolved.applications)};
      });
      return trustedItems.map((item,index)=>({ ...item,attributes:{ ...item.attributes,...vehicleAttributes.get(index) } }));
    }
  };
}

function isCheckoutTestProductEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_CHECKOUT_TEST_PRODUCT === "true";
}

async function validateVehicleApplicationReferences(items: CartItem[]) {
  const legacyIds = [
    ...new Set(
      items
        .map((item) => item.attributes.vehicle_application_id)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  ];
  const canonicalIds = [
    ...new Set(
      items
        .map((item) => item.attributes.vehicle_fitment_application_id)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  ];

  if (legacyIds.length) {
    throw new ProductUnavailableError("Legacy vehicle fitment references are no longer accepted.");
  }
  if (!canonicalIds.length) return;
  if (canonicalIds.some((id) => !isVehicleCatalogApplicationId(id))) {
    throw new ProductUnavailableError("Vehicle fitment reference is invalid.");
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new ProductUnavailableError("Vehicle fitment could not be verified.");
  const canonicalResult = await supabase
    .from("vehicle_catalog_applications")
    .select("application_id,vehicle_catalog_wiper_fitments!inner(application_id,fitment_status,wiper_configurations!inner(configuration_status))")
    .in("application_id", canonicalIds)
    .eq("vehicle_catalog_wiper_fitments.fitment_status", "published")
    .eq("vehicle_catalog_wiper_fitments.wiper_configurations.configuration_status", "published");

  if (canonicalResult.error) throw canonicalResult.error;
  if ((canonicalResult.data ?? []).length !== canonicalIds.length) {
    throw new ProductUnavailableError("Vehicle fitment reference is no longer available.");
  }
}

function sanitizeAttributes(attributes: CartItem["attributes"] | unknown): CartItem["attributes"] {
  if (!attributes || typeof attributes !== "object") return {};
  return attributes as CartItem["attributes"];
}

