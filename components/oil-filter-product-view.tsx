import { ProductVehicleFitment } from '@/components/product-vehicle-fitment';
import { OilFilterProductGallery } from "@/components/oil-filter-product-gallery";
import { OilFilterPurchase } from "@/components/oil-filter-purchase";
import { formatMoney } from "@/lib/catalog";
import type { OilFilterDetail } from "@/lib/oil-filter";
import { getProductFitmentStatusForVehicle, type ProductVehicleFitmentStatus } from "@/lib/queries/vehicle-product-fitment";
import { readStoredVehicleContext } from "@/lib/server/vehicle-context";

export async function OilFilterProductView({ detail }: { detail: OilFilterDetail }) {
  const vehicle = await readStoredVehicleContext();
  let vehicleFitmentStatus: ProductVehicleFitmentStatus | "not-selected" = "not-selected";
  if (vehicle) {
    try {
      vehicleFitmentStatus = await getProductFitmentStatusForVehicle(detail.partNumber, {
        makeId: vehicle.makeId,
        modelId: vehicle.modelId,
        year: Number(vehicle.year),
        applicationId: vehicle.applicationId,
        applicationIds: vehicle.applicationIds,
        variantGroup: vehicle.variantGroup
      });
    } catch {
      vehicleFitmentStatus = "unavailable";
    }
  }
  const titleParts = splitOilFilterTitle(detail.title);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: detail.title,
    sku: detail.partNumber,
    category: "Oil Filters",
    image: [`https://nexautoparts.co.nz${detail.imageUrl}`],
    description: `${detail.title}. Mostly for ${detail.mostlyFor}.`,
    offers: {
      "@type": "Offer",
      priceCurrency: "NZD",
      price: detail.variant.price,
      availability: detail.variant.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
    }
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-8">
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <OilFilterProductGallery
            items={[{ src: detail.imageUrl, alt: `${detail.title} product view`, label: "Product photo" }]}
            illustrative={false}
          />
        </div>

        <section className="space-y-4">
          <header>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-signal sm:text-sm sm:tracking-[0.18em]">Oil Filters</p>
            <h1 className="mt-2 text-2xl font-black leading-tight text-ink sm:mt-3 sm:text-4xl">
              {titleParts.title}
              {titleParts.fitmentSubtitle ? (
                <span className="mt-2 block text-xl leading-snug text-steel sm:text-3xl">{titleParts.fitmentSubtitle}</span>
              ) : null}
            </h1>
            <div className="mt-3 space-y-0.5 text-sm font-bold text-steel">
              <p>SKU: {detail.partNumber}</p>
            </div>
            <div className="mt-4">
              <p className="text-3xl font-black sm:text-4xl">{formatMoney(detail.variant.price)}</p>
            </div>
          </header>

          <ProductVehicleFitment checkedVehicle={vehicle} status={vehicleFitmentStatus}/>

          <OilFilterPurchase detail={detail} vehicle={vehicle} vehicleFitmentStatus={vehicleFitmentStatus} />
        </section>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="mb-4">
            <h2 className="text-2xl font-black sm:text-3xl">Product Specifications</h2>
          </div>

          <div className="divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 bg-white">
            <AccordionItem title={`Dimensions and model fitment · ${detail.partNumber}`} open>
              <dl className="overflow-hidden rounded-lg border border-black/10">
                {detail.specifications.map((spec) => (
                  <div key={spec.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 border-b border-black/10 px-4 py-3 last:border-b-0 odd:bg-zinc-50">
                    <dt className="font-black text-ink">{spec.label}</dt>
                    <dd className="break-words text-right text-steel">{spec.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6">
                <h3 className="font-black text-ink">Model fitment</h3>
                <p className="mt-2">{detail.mostlyFor}</p>
              </div>
            </AccordionItem>

            <AccordionItem title="Installation Notes">
              Compare the replacement filter and supplied seals with the removed part before installation. Follow the vehicle manufacturer&apos;s tightening procedure and check for leaks after start-up.
            </AccordionItem>
            <AccordionItem title="Shipping">
              Orders are dispatched from Auckland. Final dispatch timing is confirmed with current stock availability.
            </AccordionItem>
            <AccordionItem title="Returns & Warranty">
              Contact NexAutoParts before installation if the filter does not match the removed part. Installed or oil-contaminated items may have restricted return eligibility.
            </AccordionItem>
          </div>
        </div>
      </section>
    </main>
  );
}

function splitOilFilterTitle(title: string) {
  const marker = " Fits ";
  const index = title.indexOf(marker);
  if (index < 0) return { title, fitmentSubtitle: "" };
  return {
    title: title.slice(0, index),
    fitmentSubtitle: `Fits ${title.slice(index + marker.length)}`
  };
}

function AccordionItem({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="group p-5" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-black">
        {title}
        <span className="text-signal transition group-open:rotate-45">+</span>
      </summary>
      <div className="mt-4 text-sm font-bold leading-7 text-steel">{children}</div>
    </details>
  );
}
