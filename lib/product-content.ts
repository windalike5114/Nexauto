import { blobMediaAssets } from "@/lib/blob-media-assets";
import type { Product } from "@/lib/types";

const mainWiperProductImage = blobMediaAssets.images.find((asset) => asset.name === "nexautowiper1")?.url ?? "/products/wiper-blade.png";

export function productImage(product: Product) {
  if (product.category === "wiper") return mainWiperProductImage;
  if (product.category === "bulb") return "/products/halogen-bulb.png";
  return product.images[0] ?? "";
}

export function productDetailContent(product: Product) {
  const databaseSections = product.detailSections;

  if (product.category === "wiper") {
    return {
      kicker: "Built for daily visibility",
      intro:
        "A practical replacement blade for customers who know their length and connector type. The SKU system keeps every length and connector combination separate, so stock and pricing stay clean as the range grows.",
      highlights: ["Quiet rubber sweep", "Connector-specific SKU matching", "All-season everyday replacement"],
      sections: databaseSections.length
        ? databaseSections
        : [
            {
              title: "What customers choose",
              body: "Customers select blade length and connector type, then the product page resolves that choice to the exact sellable SKU. This avoids creating one product per vehicle while keeping the buying flow simple."
            },
            {
              title: "Stock control",
              body: "Every variant carries its own stock and price, so uncommon sizes can be managed separately without changing the storefront logic."
            }
          ]
    };
  }

  if (product.category === "bulb") {
    if (product.slug === "h11-headlight-license-plate-bulb-bundle") {
      return {
        kicker: "Lighting refresh bundle",
        intro:
          "A value-focused exterior lighting bundle for drivers who already know they need H11 replacement bulbs. It pairs four H11 12V halogen bulbs with licence plate light bulbs so common lighting maintenance can be handled in one order.",
        highlights: ["4 x H11 halogen bulbs", "Licence plate bulbs included", "12V exterior lighting refresh"],
        sections: databaseSections.length
          ? databaseSections
          : [
              {
                title: "Bundle Contents",
                body: "Includes four H11 12V halogen replacement bulbs for vehicles that use H11 fitment, plus licence plate light bulbs for a clean exterior lighting refresh."
              },
              {
                title: "Fitment Reminder",
                body: "H11 bulbs are commonly used in low beam, fog light, and daytime running light applications depending on the vehicle. Please confirm your existing bulb type before ordering."
              }
            ]
      };
    }

    return {
      kicker: "Clear replacement lighting",
      intro:
        "A catalog-ready halogen bulb range for base-type driven shopping. Customers choose the base type and voltage, then the store maps that choice to a real SKU.",
      highlights: ["Base type selection", "Voltage-specific variants", "Glass and metal replacement bulb format"],
      sections: databaseSections.length
        ? databaseSections
        : [
            {
              title: "Simple base matching",
              body: "The product page focuses on practical attributes like H7 or H11 instead of vehicle-specific product duplication."
            },
            {
              title: "Expandable category logic",
              body: "The same attribute system can later support beam color, wattage, pack size, or premium bulb tiers."
            }
          ]
    };
  }

  return {
    kicker: "Spec-first replacement parts",
    intro: product.description,
    highlights: ["SKU-level stock", "Attribute-driven selection", "Ready for fitment expansion"],
    sections: databaseSections.length
      ? databaseSections
      : [
          {
            title: "Flexible product data",
            body: "Products can define their own attributes while keeping one shared product detail flow."
          }
        ]
  };
}
