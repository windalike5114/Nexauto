import { blobMediaAssets } from "@/lib/blob-media-assets";
import type { Product } from "@/lib/types";

const mainWiperProductImage = blobMediaAssets.images.find((asset) => asset.name === "nexautowiper1")?.url ?? "/products/wiper-blade.png";

export function productImage(product: Product) {
  if (product.slug === "premium-rear-wiper-blade") return "/products/rear-wiper-blade.png";
  if (product.category === "battery") return product.images[0] ?? "/products/vehicle-battery.png";
  if (product.category === "filter") return product.images[0] ?? "/products/vehicle-oil-filter.png";
  if (product.category === "brake-pad") return product.images[0] ?? "/products/brake-pads/ceramic-brake-pad-set.png";
  if (product.category === "wiper") return mainWiperProductImage;
  if (product.category === "bulb") return product.images[0] ?? "/products/halogen-bulb.png";
  return product.images[0] ?? "";
}

export function productHref(product: Product) {
  if (product.category === "bulb" && /^bulb-nbl\d{4}$/i.test(product.slug)) {
    return `/bulbs/${product.slug.replace(/^bulb-/i, "").toUpperCase()}`;
  }
  if (product.category === "brake-pad") {
    const sku = product.slug.replace(/^brake-pad-/i, "").toUpperCase();
    return `/brake-pads/${encodeURIComponent(sku)}`;
  }
  if (product.category === "filter") {
    const sku = product.slug.replace(/^oil-filter-/i, "").toUpperCase();
    if (sku !== product.slug.toUpperCase()) return `/oil-filters/${encodeURIComponent(sku)}`;
  }
  return `/products/${product.slug}`;
}

export function productDetailContent(product: Product) {
  const databaseSections = product.detailSections;

  if (product.category === "wiper") {
    if (product.slug === "premium-rear-wiper-blade") {
      return {
        kicker: "Rear visibility support",
        intro:
          "A premium rear wiper blade option for vehicles that require a separate rear screen blade. Select the correct blade length, and contact us if you need help confirming fitment for your vehicle.",
        highlights: ["Rear blade sizes 8 to 16 inch", "Quiet everyday wipe", "Suitable for NZ road conditions"],
        sections: databaseSections.length
          ? databaseSections
          : [
              {
                title: "Rear window coverage",
                body: "Designed for rear screen wiping performance where a separate rear blade is fitted. Choose the listed blade length that matches your vehicle requirement."
              },
              {
                title: "Fitment support",
                body: "Rear blade attachment styles can vary between vehicles. If you are unsure which rear blade size or fitting applies, contact NexAutoParts with your vehicle details before ordering."
              }
            ]
      };
    }

    return {
      kicker: "Built for daily visibility",
      intro:
        product.description,
      highlights: ["Quiet rubber sweep", "All-weather rubber", "Everyday replacement"],
      sections: databaseSections
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
        "Replacement halogen bulbs.",
      highlights: ["Halogen", "Glass and metal"],
      sections: databaseSections
    };
  }

  if (product.category === "battery") {
    return {
      kicker: "Vehicle-specific battery supply",
      intro:
        product.description,
      highlights: [],
      sections: databaseSections.length
        ? databaseSections
        : [
            {
              title: "Fitment confirmation required",
              body: "Battery selection must be confirmed against the vehicle application, case dimensions, terminal layout and electrical requirements before supply."
            }
          ]
    };
  }

  if (product.category === "filter") {
    return {
      kicker: "Engine-specific filter matching",
      intro:
        product.description,
      highlights: [],
      sections: databaseSections.length
        ? databaseSections
        : [
            {
              title: "Fitment confirmation required",
              body: "Oil filters vary by engine code and production range. Cross-reference numbers assist identification but do not replace vehicle fitment confirmation."
            }
          ]
    };
  }

  if (product.category === "brake-pad") {
    return {
      kicker: "Brake-system-specific matching",
      intro: product.description,
      highlights: [],
      sections: databaseSections.length
        ? databaseSections
        : [
            {
              title: "Fitment confirmation required",
              body: "Brake pads must be matched against the exact axle, brake system and production range. Dimensions support identification but do not replace vehicle fitment confirmation."
            }
          ]
    };
  }

  return {
    kicker: "Replacement parts",
    intro: product.description,
    highlights: [],
    sections: databaseSections
  };
}
