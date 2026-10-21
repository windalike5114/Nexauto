import Link from "next/link";
import { AlertTriangle, CircleHelp } from "lucide-react";
import { OilFilterProductGallery } from "@/components/oil-filter-product-gallery";
import { OilFilterPurchase } from "@/components/oil-filter-purchase";
import { formatMoney } from "@/lib/catalog";
import { formatDimension, type OilFilterDetail } from "@/lib/oil-filter";
import { readStoredVehicleContext } from "@/lib/server/vehicle-context";

export async function OilFilterProductView({ detail }: { detail: OilFilterDetail }) {
  const vehicle = await readStoredVehicleContext();
  const vehicleLabel = vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "";
  const vehicleDetail = vehicle ? [vehicle.chassis, vehicle.bodyConfiguration, vehicle.engine].filter(Boolean).join(" · ") : "";
  const titleParts = splitOilFilterTitle(detail.title);
  const keySpecs = [
    { label: "Type", value: detail.construction },
    detail.heightMm ? { label: "Height", value: `${formatDimension(detail.heightMm)} mm` } : null,
    detail.outsideDiameter ? { label: "Outside Diameter", value: `${detail.outsideDiameter} mm` } : null,
    detail.insideDiameter
      ? { label: "Inside Diameter", value: `${detail.insideDiameter} mm` }
      : detail.threadSize
        ? { label: "Thread Size", value: detail.threadSize }
        : detail.sealRingSize
          ? { label: "Seal Ring Size", value: detail.sealRingSize }
          : null
  ].filter((item): item is { label: string; value: string } => Boolean(item));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: detail.title,
    sku: detail.partNumber,
    mpn: detail.supplierRef,
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
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-7 sm:px-6 sm:py-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-8">
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <OilFilterProductGallery
            items={[{ src: detail.imageUrl, alt: `${detail.title} product view`, label: "Product photo" }]}
            illustrative={false}
          />
        </div>

        <section className="space-y-4 sm:space-y-5">
          <header>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-signal sm:text-sm sm:tracking-[0.18em]">Oil Filters</p>
            <h1 className="mt-2 text-2xl font-black leading-tight text-ink sm:mt-3 sm:text-4xl">
              {titleParts.title}
              {titleParts.fitmentSubtitle ? (
                <span className="mt-2 block text-xl leading-snug text-steel sm:text-3xl">{titleParts.fitmentSubtitle}</span>
              ) : null}
            </h1>
            <p className="mt-3 text-sm font-bold leading-6 text-steel">
              <span className="font-black text-ink">Mostly for:</span> {detail.mostlyFor}
            </p>
            <div className="mt-3 space-y-0.5 text-sm font-bold text-steel">
              <p>SKU: {detail.partNumber}</p>
              <p className="text-xs">Supplier ref: {detail.supplierRef}</p>
            </div>
            <div className="mt-5">
              <p className="text-3xl font-black sm:text-4xl">{formatMoney(detail.variant.price)}</p>
              <p className="mt-1 text-xs font-bold text-steel">GST incl. · Price shown for one filter</p>
            </div>
          </header>

          <CompatibilityPanel selected={Boolean(vehicle)} vehicleLabel={vehicleLabel} vehicleDetail={vehicleDetail} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {keySpecs.map((spec) => (
              <div key={spec.label} className="rounded-lg border border-black/10 bg-white p-3 shadow-sm sm:p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-steel sm:text-xs">{spec.label}</p>
                <p className="mt-1.5 break-words text-sm font-black text-ink sm:text-base">{spec.value}</p>
              </div>
            ))}
          </div>

          <OilFilterPurchase detail={detail} />
        </section>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          <div className="mb-7">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Product description</p>
            <h2 className="mt-2 text-3xl font-black">Details for {detail.partNumber}</h2>
            <p className="mt-3 text-sm font-bold leading-7 text-steel">
              Product dimensions and model coverage are rendered from the uploaded oil-filter catalogue.
            </p>
          </div>

          <div className="divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 bg-white">
            <AccordionItem title="Product Specifications" open>
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

            <AccordionItem title="Vehicle Compatibility" open={Boolean(vehicle)}>
              {vehicle ? (
                <p>
                  A separate verified fitment record is not yet published for {vehicleLabel}{vehicleDetail ? ` · ${vehicleDetail}` : ""}.
                  The model list above is for product identification and does not decide Fits / Not fit.
                </p>
              ) : (
                <p>Select your vehicle to use the dedicated fitment catalogue when a verified application record is available.</p>
              )}
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

function CompatibilityPanel({ selected, vehicleLabel, vehicleDetail }: { selected: boolean; vehicleLabel: string; vehicleDetail: string }) {
  const visual = selected
    ? {
        icon: <AlertTriangle className="h-5 w-5" />,
        panel: "border-amber-700/20 bg-amber-50",
        iconBox: "bg-amber-600 text-white",
        eyebrow: "text-amber-800",
        title: "Fitment confirmation required",
        body: `Selected: ${vehicleLabel}${vehicleDetail ? ` · ${vehicleDetail}` : ""}`
      }
    : {
        icon: <CircleHelp className="h-5 w-5" />,
        panel: "border-black/10 bg-[#F8FAFC]",
        iconBox: "bg-signal text-white",
        eyebrow: "text-signal",
        title: "This product is vehicle specific",
        body: "Select your vehicle to check fitment."
      };

  return (
    <section className={`rounded-lg border p-4 ${visual.panel}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${visual.iconBox}`}>{visual.icon}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-black uppercase tracking-[0.14em] ${visual.eyebrow}`}>Vehicle compatibility</p>
          <h2 className="mt-1 text-lg font-black leading-tight text-ink">{visual.title}</h2>
          <p className="mt-1 text-sm font-bold leading-6 text-steel">{visual.body}</p>
          <Link href="/parts#change-vehicle" className="mt-3 inline-flex h-10 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white hover:bg-black">
            {selected ? "Change Vehicle" : "Select Vehicle"}
          </Link>
        </div>
      </div>
    </section>
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
