import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CarFront, CheckCircle2, ShieldCheck } from "lucide-react";
import { WiperSetPurchase } from "@/components/wiper-set-purchase";
import { formatMoney } from "@/lib/catalog";
import { getWiperRearAddonByLength, getWiperSetByLengths } from "@/lib/queries/wiper-commerce";
import { findWiperFitmentsByVehiclePath } from "@/lib/queries/wiper-fitment";

export const dynamic = "force-dynamic";

export default async function VehicleWiperPage({ params }: { params: Promise<{ make: string; model: string; year: string }> }) {
  const { make: makeSlug, model: modelSlug, year: yearParam } = await params;
  const year = Number(yearParam);

  if (!Number.isFinite(year)) notFound();

  const vehicleFitment = await findWiperFitmentsByVehiclePath(makeSlug, modelSlug, year);
  if (!vehicleFitment.make || !vehicleFitment.model) notFound();

  const fitment = vehicleFitment.fitments[0] ?? null;
  const [frontPair, rearAddon] = await Promise.all([
    fitment?.driverLengthIn && fitment.passengerLengthIn
      ? getWiperSetByLengths(fitment.driverLengthIn, fitment.passengerLengthIn)
      : Promise.resolve(null),
    getWiperRearAddonByLength(fitment?.rearLengthIn ?? null)
  ]);

  const vehicleName = `${vehicleFitment.make.name} ${vehicleFitment.model.name} ${year}`;
  const productHref =
    frontPair && fitment
      ? buildWiperSkuHref({
          sku: frontPair.sku,
          applicationId: fitment.applicationId,
          make: vehicleFitment.make.name,
          model: vehicleFitment.model.name,
          year,
          rearAddonId: rearAddon?.id ?? null
        })
      : "";

  return (
    <main className="bg-white">
      <section className="border-b border-black/10 bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Link href="/" className="text-sm font-black text-signal hover:text-red-700">
            Search another vehicle
          </Link>
          <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Vehicle wiper result</p>
              <h1 className="mt-3 text-4xl font-black leading-tight text-ink sm:text-5xl">{vehicleName}</h1>
              <p className="mt-4 max-w-2xl text-lg font-semibold leading-8 text-steel">
                Blade lengths are matched from vehicle fitment data. Connector selection is handled internally before dispatch.
              </p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white p-5 shadow-panel">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-lg bg-signal text-white">
                  <CarFront className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-black">Selected vehicle</p>
                  <p className="text-sm font-bold text-steel">{vehicleName}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:px-8">
        <div className="space-y-5">
          <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-signal" />
              <h2 className="text-xl font-black">Fitment details</h2>
            </div>

            {fitment ? (
              <>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <SpecCard label="Driver blade" value={formatLength(fitment.driverLengthIn)} />
                  <SpecCard label="Passenger blade" value={formatLength(fitment.passengerLengthIn)} />
                  <SpecCard label="Rear blade" value={fitment.rearLengthIn ? formatLength(fitment.rearLengthIn) : "Not listed"} />
                </div>
                <div className="mt-5 rounded-lg bg-zinc-50 p-4 text-sm font-bold leading-6 text-steel">
                  Fitment range: <span className="text-ink">{fitment.startRaw ?? "Unknown"}</span> to{" "}
                  <span className="text-ink">{fitment.endRaw ?? "Unknown"}</span>. Compatible connector is hidden from customers and reserved for admin fulfillment.
                </div>
              </>
            ) : (
              <div className="mt-5 rounded-lg bg-zinc-50 p-5 text-sm font-bold text-steel">
                We could not find blade length data for this exact year yet.
              </div>
            )}
          </section>

          <section className="rounded-lg border border-black/10 bg-ink p-5 text-white">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-signal" />
              <h2 className="text-xl font-black">How this order is handled</h2>
            </div>
            <p className="mt-3 text-sm font-semibold leading-6 text-white/75">
              Your vehicle stays attached to the cart and Stripe order. Admin can see the vehicle, matched front pair SKU, and connector fulfillment fields.
            </p>
          </section>
        </div>

        <section className="space-y-5">
          {frontPair && fitment ? (
            <>
              <article className="rounded-lg border border-black/10 bg-white p-5 shadow-panel">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Recommended front pair</p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-2xl font-black">{frontPair.name}</h2>
                    <p className="mt-1 font-mono text-sm font-black text-steel">{frontPair.sku}</p>
                  </div>
                  <p className="text-2xl font-black">{formatMoney(frontPair.price)}</p>
                </div>
                <p className="mt-4 text-sm font-bold leading-6 text-steel">
                  Front driver and passenger blades are sold as one matched pair. Customers do not need to choose lengths or connector.
                </p>
                <Link
                  href={productHref as never}
                  className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded border border-black/10 px-4 text-sm font-black text-ink hover:border-ink"
                >
                  View product page
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </article>

              <WiperSetPurchase
                wiperSet={frontPair}
                rearAddon={rearAddon}
                vehicle={vehicleName}
                vehicleContext={{
                  applicationId: fitment.applicationId,
                  make: vehicleFitment.make.name,
                  model: vehicleFitment.model.name,
                  year
                }}
              />
            </>
          ) : (
            <article className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">No sellable front pair yet</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-steel">
                The vehicle fitment exists, but there is no active front pair SKU for this blade combination yet.
              </p>
              <Link href="/" className="mt-5 inline-flex h-11 items-center justify-center rounded bg-signal px-4 text-sm font-black text-white">
                Search again
              </Link>
            </article>
          )}
        </section>
      </section>
    </main>
  );
}

function SpecCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-zinc-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className="mt-2 text-3xl font-black text-ink">{value}</p>
    </div>
  );
}

function formatLength(value: number | null) {
  return value ? `${value}"` : "N/A";
}

function buildWiperSkuHref({
  sku,
  applicationId,
  make,
  model,
  year,
  rearAddonId
}: {
  sku: string;
  applicationId: string;
  make: string;
  model: string;
  year: number;
  rearAddonId: string | null;
}) {
  const params = new URLSearchParams({
    vehicle: `${make} ${model} ${year}`,
    applicationId,
    make,
    model,
    year: String(year)
  });

  if (rearAddonId) params.set("rearAddonId", rearAddonId);
  return `/wipers/${sku}?${params.toString()}`;
}
