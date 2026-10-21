import { BrakePadProductGallery } from "@/components/brake-pad-product-gallery";
import { BrakePadPurchase } from "@/components/brake-pad-purchase";
import {
  formatBrakePadDimension,
  splitBrakePadDisplayTitle,
  type BrakePadDetail,
  type BrakePadFitment
} from "@/lib/brake-pad";
import { formatMoney } from "@/lib/catalog";
import { getProductFitmentStatusForVehicle, type ProductVehicleFitmentStatus } from "@/lib/queries/vehicle-product-fitment";
import { readStoredVehicleContext } from "@/lib/server/vehicle-context";

export async function BrakePadProductView({ detail }: { detail: BrakePadDetail }) {
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
  const displayTitle = splitBrakePadDisplayTitle(detail.title);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: detail.title,
    sku: detail.partNumber,
    category: "Brake Pads",
    image: [`https://nexautoparts.co.nz${detail.imageUrl}`],
    description: detail.title,
    offers: {
      "@type": "Offer",
      priceCurrency: "NZD",
      price: detail.variant.price,
      availability: "https://schema.org/OutOfStock"
    }
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-8">
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <BrakePadProductGallery
            items={[{ src: detail.imageUrl, alt: `${detail.title} product view`, label: "Product photo" }]}
            illustrative={detail.imageIsIllustrative}
          />
        </div>

        <section className="space-y-4">
          <header>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-signal sm:text-sm sm:tracking-[0.18em]">Brake Pads</p>
            <h1 className="mt-2 text-2xl font-black leading-tight text-ink sm:mt-3 sm:text-4xl">{displayTitle.title}</h1>
            {displayTitle.fitmentSubtitle ? (
              <p className="mt-2 text-xl font-black leading-snug text-steel sm:text-3xl">{displayTitle.fitmentSubtitle}</p>
            ) : null}
            <div className="mt-3 space-y-0.5 text-sm font-bold text-steel">
              <p>SKU: {detail.partNumber}</p>
              <p className="text-xs">Supplier ref: {detail.supplierRef}</p>
            </div>
            <div className="mt-4">
              <p className="text-3xl font-black sm:text-4xl">{formatMoney(detail.variant.price)}</p>
              <p className="mt-1 text-xs font-bold text-steel">GST incl. · Price shown for one listed set</p>
            </div>
          </header>

          <BrakePadPurchase
            detail={detail}
            vehicleFitmentStatus={vehicleFitmentStatus}
            vehicleLabel={[vehicleLabel, vehicleDetail].filter(Boolean).join(" · ")}
          />
        </section>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="mb-4">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Product description</p>
            <h2 className="mt-1 text-2xl font-black sm:text-3xl">Product Specifications</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-steel">
              Dimensions are generated from the uploaded brake-pad catalogue. Vehicle fitment remains blank where no detailed records were supplied.
            </p>
          </div>

          <div className="divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 bg-white">
            <AccordionItem title={`Dimensions and fitment · ${detail.partNumber}`} open>
              <p className="mb-5">{detail.packDescription}. Confirm the pad shape, dimensions and brake system before installation.</p>
              <DimensionsTable detail={detail} />
              <FitmentTable fitments={detail.fitments} />
            </AccordionItem>

            {detail.fitments.length > 0 ? (
              <AccordionItem title="Vehicle Compatibility" open={Boolean(vehicle)}>
                <p>
                  The application rows shown in Product Specifications are informational only and are not used to decide Fits / Not fit.
                  {vehicle ? ` Compatibility for ${vehicleLabel}${vehicleDetail ? ` · ${vehicleDetail}` : ""} will be checked against the separate vehicle-fitment table.` : " Select a vehicle to prepare a compatibility check against the separate vehicle-fitment table."}
                </p>
              </AccordionItem>
            ) : null}

            <AccordionItem title="Installation & Bedding-in Notes">
              Brake pads are safety-critical parts and should be installed by a suitably qualified person. Inspect the discs, caliper slides and related hardware, follow the vehicle manufacturer&apos;s torque procedure, then complete the pad maker&apos;s bedding-in process before normal use.
            </AccordionItem>

            <AccordionItem title="Shipping">
              Orders are dispatched from Auckland. Final dispatch timing is confirmed with current stock availability.
            </AccordionItem>

            <AccordionItem title="Returns & Warranty">
              Compare the new pad shape and dimensions before installation. Contact NexAutoParts immediately if the supplied set does not match the confirmed vehicle application; installed or contaminated brake components may have restricted return eligibility.
            </AccordionItem>
          </div>
        </div>
      </section>
    </main>
  );
}

function DimensionsTable({ detail }: { detail: BrakePadDetail }) {
  const dimensions = [
    ["Length", detail.lengthMm],
    ["Width", detail.widthMm],
    ["Thickness", detail.thicknessMm]
  ] as const;

  return (
    <section aria-labelledby="brake-pad-dimensions">
      <h3 id="brake-pad-dimensions" className="mb-3 text-base font-black text-ink">Dimensions</h3>
      <div className="overflow-hidden rounded-lg border border-black/10">
        <table className="w-full table-fixed text-left text-xs sm:text-sm">
          <thead className="bg-ink text-white">
            <tr>{dimensions.map(([label]) => <th key={label} className="px-3 py-2.5 font-black">{label}</th>)}</tr>
          </thead>
          <tbody>
            <tr>{dimensions.map(([label, value]) => <td key={label} className="px-3 py-3 font-black text-ink">{formatBrakePadDimension(value ?? 0)} mm</td>)}</tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FitmentTable({ fitments }: { fitments: BrakePadFitment[] }) {
  return (
    <section className="mt-7" aria-labelledby="brake-pad-fitment-table">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h3 id="brake-pad-fitment-table" className="text-base font-black text-ink">Vehicle fitment</h3>
        {fitments.length > 0 ? <p className="text-xs font-bold text-steel">{fitments.length} listed application{fitments.length === 1 ? "" : "s"}</p> : null}
      </div>
      <div className="max-h-[420px] overflow-auto rounded-lg border border-black/10">
        <table className="min-w-[660px] w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-ink text-white">
            <tr>
              <th className="px-3 py-2.5 font-black">Make</th>
              <th className="px-3 py-2.5 font-black">Model</th>
              <th className="px-3 py-2.5 font-black">Chassis</th>
              <th className="px-3 py-2.5 font-black">Engine</th>
            </tr>
          </thead>
          <tbody>
            {fitments.map((fitment, index) => (
              <tr key={`${fitment.make}-${fitment.model}-${fitment.chassis}-${fitment.engine}-${index}`} className="border-t border-black/10 odd:bg-zinc-50">
                <td className="whitespace-nowrap px-3 py-2.5 font-black text-ink">{fitment.make}</td>
                <td className="px-3 py-2.5 font-bold text-ink">{fitment.model}</td>
                <td className="px-3 py-2.5 font-semibold text-steel">{fitment.chassis || "—"}</td>
                <td className="px-3 py-2.5 font-semibold text-steel">{fitment.engine || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
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
