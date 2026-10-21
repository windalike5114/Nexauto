import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  PackageCheck,
  Ruler,
  ShieldCheck,
  Truck
} from "lucide-react";
import { OilFilterProductGallery } from "@/components/oil-filter-product-gallery";
import { OilFilterPurchase } from "@/components/oil-filter-purchase";
import { formatMoney } from "@/lib/catalog";
import { formatDimension, type OilFilterDetail } from "@/lib/oil-filter";
import { hasPublishedOilFilterFitment } from "@/lib/queries/oil-filter-catalog";
import { readStoredVehicleContext } from "@/lib/server/vehicle-context";

export async function OilFilterProductView({ detail }: { detail: OilFilterDetail }) {
  const vehicle = await readStoredVehicleContext();
  const fitsSelectedVehicle = vehicle?.applicationId
    ? await hasPublishedOilFilterFitment(detail.variant.id, vehicle.applicationId)
    : false;
  const vehicleLabel = vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "";
  const vehicleDetail = vehicle ? [vehicle.chassis, vehicle.bodyConfiguration, vehicle.engine].filter(Boolean).join(" · ") : "";
  const galleryItems = [
    { src: detail.imageUrl, alt: `${detail.title} product view`, label: "Product photo" },
    detail.packagingImageUrl
      ? { src: detail.packagingImageUrl, alt: `${detail.title} pack contents`, label: "Packaging" }
      : null,
    detail.dimensionImageUrl
      ? { src: detail.dimensionImageUrl, alt: `${detail.title} dimension diagram`, label: "Dimensions" }
      : null
  ].filter((item): item is { src: string; alt: string; label: string } => Boolean(item));
  const keySpecs = [
    { label: "Type", value: detail.construction },
    detail.heightMm ? { label: "Height", value: `${formatDimension(detail.heightMm)} mm` } : null,
    detail.outsideDiameterMm ? { label: "Diameter", value: `${formatDimension(detail.outsideDiameterMm)} mm` } : null,
    { label: "Pack", value: `${detail.packQuantity} Filter` }
  ].filter((item): item is { label: string; value: string } => Boolean(item));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: detail.title,
    sku: detail.partNumber,
    brand: { "@type": "Brand", name: detail.brand },
    category: "Oil Filters",
    image: [`https://nexautoparts.co.nz${detail.imageUrl}`],
    description: `${detail.construction} oil filter. Confirm the exact vehicle engine and production range before ordering.`,
    ...(detail.product.purchasable
      ? {
          offers: {
            "@type": "Offer",
            priceCurrency: "NZD",
            price: detail.variant.price,
            availability: detail.variant.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
          }
        }
      : {})
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-7 sm:px-6 sm:py-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8 lg:px-8">
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <OilFilterProductGallery items={galleryItems} illustrative={detail.imageIsIllustrative} />
        </div>

        <section className="space-y-5 sm:space-y-6">
          <header>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-signal sm:text-sm sm:tracking-[0.18em]">Oil Filters</p>
            <h1 className="mt-2 text-3xl font-black leading-tight text-ink sm:mt-3 sm:text-5xl">{detail.title}</h1>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold text-steel">
              <span>SKU: {detail.partNumber}</span>
            </div>
            <div className="mt-5">
              <p className="text-3xl font-black sm:text-4xl">
                {detail.product.purchasable ? formatMoney(detail.variant.price) : "NZ$ —"}
              </p>
              <p className="mt-1 text-xs font-bold text-steel">
                GST incl. · {detail.product.purchasable ? "Price shown for one filter" : "Price to be set"}
              </p>
            </div>
          </header>

          <CompatibilityPanel
            selected={Boolean(vehicle)}
            confirmed={fitsSelectedVehicle}
            vehicleLabel={vehicleLabel}
            vehicleDetail={vehicleDetail}
          />

          <div className={`grid gap-3 ${keySpecs.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
            {keySpecs.map((spec) => (
              <div key={spec.label} className="rounded-lg border border-black/10 bg-white p-3 shadow-sm sm:p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-steel sm:text-xs">{spec.label}</p>
                <p className="mt-1.5 text-sm font-black text-ink sm:text-base">{spec.value}</p>
              </div>
            ))}
          </div>

          <OilFilterPurchase detail={detail} />

          <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-black text-steel sm:text-xs">
            <TrustItem icon={<ClipboardCheck className="h-4 w-4" />} text="Fitment Support" />
            <TrustItem icon={<Ruler className="h-4 w-4" />} text="Detailed Specs" />
            <TrustItem icon={<Truck className="h-4 w-4" />} text="NZ Dispatch" />
          </div>
        </section>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:px-6 sm:py-12 md:grid-cols-3 lg:px-8">
          <FeatureCard icon={<ShieldCheck className="h-5 w-5" />} title="Engine protection" text="Built to help capture contaminants from circulating engine oil during normal service intervals." />
          <FeatureCard icon={<ClipboardCheck className="h-5 w-5" />} title="Fitment-first ordering" text="Compatibility is confirmed against the exact engine application, not assumed from a cross-reference alone." />
          <FeatureCard icon={<PackageCheck className="h-5 w-5" />} title="What is shown is what matters" text="Only available specification fields are displayed. Missing values are never guessed or padded with N/A." />
        </div>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-7">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Product information</p>
            <h2 className="mt-2 text-3xl font-black">Details for {detail.partNumber}</h2>
            <p className="mt-3 text-sm font-bold leading-7 text-steel">Generated from one structured product record so the same template can support the full filter range.</p>
          </div>

          <div className="divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 bg-white">
            <AccordionItem title="Product Details" open>
              <p>{detail.title} is supplied as a pack of {detail.packQuantity}. Confirm the exact engine and production range before ordering.</p>
              {detail.imageIsIllustrative ? <p className="mt-2 text-xs">The displayed product image is illustrative. Final appearance and included seals must be confirmed against the saleable SKU data.</p> : null}
            </AccordionItem>
            <AccordionItem title="Technical Specifications" open>
              <dl className="overflow-hidden rounded-lg border border-black/10">
                {detail.specifications.map((spec) => (
                  <div key={spec.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 border-b border-black/10 px-4 py-3 last:border-b-0 odd:bg-zinc-50">
                    <dt className="font-black text-ink">{spec.label}</dt>
                    <dd className="text-right text-steel">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </AccordionItem>
            <AccordionItem title="Vehicle Compatibility" open={Boolean(vehicle)}>
              {fitsSelectedVehicle ? (
                <p>This product has a published fitment for {vehicleLabel}{vehicleDetail ? ` · ${vehicleDetail}` : ""}.</p>
              ) : vehicle ? (
                <p>No published match was found for {vehicleLabel}. This does not prove incompatibility; engine and production details still require confirmation.</p>
              ) : (
                <p>Select Make → Model → Year → Chassis → Body / drivetrain → Engine to check a published fitment.</p>
              )}
            </AccordionItem>
            <AccordionItem title="Installation Notes">
              Replace all supplied sealing rings where the confirmed pack contents include them. Lightly lubricate seals with clean engine oil, follow the vehicle manufacturer&apos;s tightening procedure, and check for leaks after start-up.
            </AccordionItem>
            <AccordionItem title="Shipping">
              Orders are dispatched from Auckland. Final dispatch timing is shown once the SKU has approved price and stock data.
            </AccordionItem>
            <AccordionItem title="Returns & Warranty">
              Contact NexAutoParts before installation if the filter or supplied seals do not match the removed part. Installed or oil-contaminated items may have restricted return eligibility.
            </AccordionItem>
          </div>
        </div>
      </section>
    </main>
  );
}

function CompatibilityPanel({ selected, confirmed, vehicleLabel, vehicleDetail }: { selected: boolean; confirmed: boolean; vehicleLabel: string; vehicleDetail: string }) {
  const visual = confirmed
    ? { icon: <CheckCircle2 className="h-5 w-5" />, panel: "border-emerald-700/20 bg-emerald-50", iconBox: "bg-emerald-700 text-white", eyebrow: "text-emerald-700", title: "Verified for your vehicle", body: `${vehicleLabel}${vehicleDetail ? ` · ${vehicleDetail}` : ""}` }
    : selected
      ? { icon: <AlertTriangle className="h-5 w-5" />, panel: "border-amber-700/20 bg-amber-50", iconBox: "bg-amber-600 text-white", eyebrow: "text-amber-800", title: "Fitment confirmation required", body: `No verified match is published for ${vehicleLabel}. This is not a confirmed incompatibility.` }
      : { icon: <CircleHelp className="h-5 w-5" />, panel: "border-black/10 bg-[#F8FAFC]", iconBox: "bg-signal text-white", eyebrow: "text-signal", title: "Check if this filter fits your vehicle", body: "Please select your vehicle and engine to confirm compatibility." };

  return (
    <section className={`rounded-lg border p-4 sm:p-5 ${visual.panel}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${visual.iconBox}`}>{visual.icon}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-black uppercase tracking-[0.14em] ${visual.eyebrow}`}>Vehicle compatibility</p>
          <h2 className="mt-1 text-lg font-black leading-tight text-ink sm:text-xl">{visual.title}</h2>
          <p className="mt-1 text-sm font-bold leading-6 text-steel">{visual.body}</p>
          {!confirmed ? <Link href="/parts#change-vehicle" className="mt-3 inline-flex h-10 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white hover:bg-black">{selected ? "Review My Vehicle" : "Check My Vehicle"}</Link> : null}
        </div>
      </div>
    </section>
  );
}

function TrustItem({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="flex min-h-14 flex-col items-center justify-center gap-1 rounded border border-black/10 bg-white px-2">{icon}<span>{text}</span></div>;
}

function FeatureCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <article className="rounded-lg border border-black/10 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-panel">
      <div className="grid h-9 w-9 place-items-center rounded-full bg-signal text-white">{icon}</div>
      <h3 className="mt-4 text-lg font-black">{title}</h3>
      <p className="mt-3 text-sm font-bold leading-7 text-steel">{text}</p>
    </article>
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
