import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import { OilFilterProductGallery } from "@/components/oil-filter-product-gallery";
import { OilFilterPurchase } from "@/components/oil-filter-purchase";
import { formatMoney } from "@/lib/catalog";
import type { OilFilterDetail } from "@/lib/oil-filter";
import { getProductFitmentStatusForVehicle, type ProductVehicleFitmentStatus } from "@/lib/queries/vehicle-product-fitment";
import { readStoredVehicleContext } from "@/lib/server/vehicle-context";

export async function OilFilterProductView({ detail }: { detail: OilFilterDetail }) {
  const vehicle = await readStoredVehicleContext();
  const vehicleLabel = vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "";
  const vehicleDetail = vehicle ? [vehicle.chassis, vehicle.bodyConfiguration, vehicle.engine].filter(Boolean).join(" · ") : "";
  let vehicleFitmentStatus: ProductVehicleFitmentStatus | "not-selected" = "not-selected";
  if (vehicle) {
    try {
      vehicleFitmentStatus = await getProductFitmentStatusForVehicle(detail.partNumber, {
        makeId: vehicle.makeId,
        modelId: vehicle.modelId,
        year: Number(vehicle.year),
        applicationId: vehicle.applicationId,
        applicationIds: vehicle.applicationIds
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
              <p className="text-xs">Supplier ref: {detail.supplierRef}</p>
            </div>
            <div className="mt-4">
              <p className="text-3xl font-black sm:text-4xl">{formatMoney(detail.variant.price)}</p>
              <p className="mt-1 text-xs font-bold text-steel">GST incl. · Price shown for one filter</p>
            </div>
          </header>

          <CompatibilityPanel status={vehicleFitmentStatus} vehicleLabel={vehicleLabel} vehicleDetail={vehicleDetail} />

          <OilFilterPurchase detail={detail} />
        </section>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="mb-4">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Product description</p>
            <h2 className="mt-1 text-2xl font-black sm:text-3xl">Product Specifications</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-steel">
              Product dimensions and model coverage are rendered from the uploaded oil-filter catalogue.
            </p>
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

            <AccordionItem title="Vehicle Compatibility" open={Boolean(vehicle)}>
              <VehicleCompatibilityCopy
                status={vehicleFitmentStatus}
                vehicleLabel={vehicleLabel}
                vehicleDetail={vehicleDetail}
              />
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

function CompatibilityPanel({ status, vehicleLabel, vehicleDetail }: {
  status: ProductVehicleFitmentStatus | "not-selected";
  vehicleLabel: string;
  vehicleDetail: string;
}) {
  const selected = status !== "not-selected";
  const visual = status === "fits"
    ? {
        icon: <CheckCircle2 className="h-5 w-5" />,
        panel: "border-emerald-700/20 bg-emerald-50",
        iconBox: "bg-emerald-700 text-white",
        eyebrow: "text-emerald-800",
        title: "Fits your selected vehicle",
        body: `${vehicleLabel}${vehicleDetail ? ` · ${vehicleDetail}` : ""}`
      }
    : status === "not-listed"
      ? {
        icon: <AlertTriangle className="h-5 w-5" />,
        panel: "border-red-700/20 bg-red-50",
        iconBox: "bg-red-700 text-white",
        eyebrow: "text-red-800",
        title: "Not listed for your selected vehicle",
        body: `${vehicleLabel}${vehicleDetail ? ` · ${vehicleDetail}` : ""}`
      }
      : status === "unavailable"
        ? {
            icon: <AlertTriangle className="h-5 w-5" />,
            panel: "border-amber-700/20 bg-amber-50",
            iconBox: "bg-amber-600 text-white",
            eyebrow: "text-amber-800",
            title: "Vehicle fitment check is temporarily unavailable",
            body: `${vehicleLabel}${vehicleDetail ? ` · ${vehicleDetail}` : ""}`
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
    <section className={`rounded-lg border p-3 ${visual.panel}`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${visual.iconBox}`}>{visual.icon}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-black uppercase tracking-[0.12em] ${visual.eyebrow}`}>Vehicle compatibility</p>
          <p className="mt-0.5 text-sm font-bold leading-5 text-steel"><span className="font-black text-ink">{visual.title}</span> · {visual.body}</p>
        </div>
        <Link href="/parts#change-vehicle" className="shrink-0 text-xs font-black text-signal hover:underline">{selected ? "Change" : "Select"}</Link>
      </div>
    </section>
  );
}

function VehicleCompatibilityCopy({ status, vehicleLabel, vehicleDetail }: {
  status: ProductVehicleFitmentStatus | "not-selected";
  vehicleLabel: string;
  vehicleDetail: string;
}) {
  const selectedVehicle = `${vehicleLabel}${vehicleDetail ? ` · ${vehicleDetail}` : ""}`;
  if (status === "fits") {
    return <p>This filter has a published fitment relationship for {selectedVehicle}.</p>;
  }
  if (status === "not-listed") {
    return <p>This filter is not published as a confirmed match for {selectedVehicle}. Check the removed filter or contact us before ordering.</p>;
  }
  if (status === "unavailable") {
    return <p>The fitment catalogue could not be checked for {selectedVehicle}. Please try again or contact us before ordering.</p>;
  }
  return <p>Select your vehicle to check this filter against the dedicated fitment catalogue.</p>;
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
