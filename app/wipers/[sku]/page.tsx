import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, PackageCheck, ShieldCheck, Wrench } from "lucide-react";
import { WiperSetPurchase } from "@/components/wiper-set-purchase";
import { formatMoney } from "@/lib/catalog";
import { getWiperRearAddonById, getWiperSetBySku } from "@/lib/queries/wiper-commerce";

export const dynamic = "force-dynamic";

type WiperSkuSearchParams = {
  vehicle?: string;
  rearAddonId?: string;
};

export default async function WiperSkuPage({
  params,
  searchParams
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<WiperSkuSearchParams>;
}) {
  const [{ sku }, query] = await Promise.all([params, searchParams]);
  const [wiperSet, rearAddon] = await Promise.all([
    getWiperSetBySku(decodeURIComponent(sku)),
    getWiperRearAddonById(query.rearAddonId)
  ]);

  if (!wiperSet) notFound();

  const vehicle = query.vehicle ? decodeURIComponent(query.vehicle) : "";

  return (
    <main>
      <section className="border-b border-black/10 bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Link href="/shop?category=wiper" className="inline-flex items-center gap-2 text-sm font-black text-steel hover:text-ink">
            <ArrowLeft className="h-4 w-4" />
            Back to wiper finder
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:px-8">
        <div className="space-y-4">
          <div className="grid min-h-[380px] place-items-center rounded-lg border border-black/10 bg-ink p-8 text-white">
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between border-b border-white/15 pb-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-white/60">NexAuto wiper kit</p>
                  <p className="mt-2 font-mono text-2xl font-black">{wiperSet.sku}</p>
                </div>
                <Wrench className="h-10 w-10 text-signal" />
              </div>
              <div className="mt-8 grid grid-cols-2 gap-4">
                <BladeVisual label="Driver" value={wiperSet.driverLengthIn} />
                <BladeVisual label="Passenger" value={wiperSet.passengerLengthIn} />
              </div>
              <p className="mt-8 text-sm font-bold leading-6 text-white/70">
                Front pair kit matched by blade length. Connector selection is checked manually during fulfillment.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <InfoTile icon={<BadgeCheck className="h-4 w-4" />} text="Length matched" />
            <InfoTile icon={<PackageCheck className="h-4 w-4" />} text="Pair SKU" />
            <InfoTile icon={<ShieldCheck className="h-4 w-4" />} text="Secure pay" />
          </div>
        </div>

        <section className="space-y-6">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Recommended wiper pair</p>
            <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">{wiperSet.name}</h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-steel">
              This SKU is generated from the front driver and passenger blade lengths found in the fitment database.
            </p>
            <p className="mt-5 text-3xl font-black">{formatMoney(wiperSet.price)}</p>
          </div>

          <WiperSetPurchase wiperSet={wiperSet} rearAddon={rearAddon} vehicle={vehicle} />

          <div className="grid gap-4 md:grid-cols-2">
            <DetailBlock title="What is included" text="One front driver-side blade and one front passenger-side blade as a matched pair." />
            <DetailBlock title="Connector handling" text="Connector fitment is kept separate from blade length. Our backend can record connector choice before dispatch." />
            <DetailBlock title="Vehicle context" text="When opened from the finder, your selected vehicle is carried into cart metadata for fulfillment." />
            <DetailBlock title="Rear blade" text="Rear blade is optional and only shown when the fitment data includes a rear length." />
          </div>
        </section>
      </section>
    </main>
  );
}

function BladeVisual({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-white/10 p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-white/55">{label}</p>
      <div className="mt-4 h-2 rounded-full bg-white" />
      <p className="mt-4 text-3xl font-black">{value}"</p>
    </div>
  );
}

function InfoTile({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex min-h-16 flex-col items-center justify-center gap-1 rounded border border-black/10 bg-white text-center text-sm font-black text-steel">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function DetailBlock({ title, text }: { title: string; text: string }) {
  return (
    <article className="rounded-lg border border-black/10 bg-white p-5">
      <h2 className="font-black">{title}</h2>
      <p className="mt-3 text-sm font-bold leading-6 text-steel">{text}</p>
    </article>
  );
}
