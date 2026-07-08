import Link from "next/link";
import { ArrowRight, ShieldCheck, Truck, Wrench } from "lucide-react";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="bg-white">
      <section className="mx-auto grid min-h-[calc(100vh-73px)] max-w-7xl content-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:px-8">
        <div className="flex flex-col justify-center">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">NZ wiper fitment tool</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight text-ink sm:text-6xl">
            Find the correct wiper blades for your vehicle.
          </h1>
          <p className="mt-5 max-w-2xl text-lg font-semibold leading-8 text-steel">
            Select your make, model, and year. NexAuto matches the blade lengths and keeps connector handling internal for fulfillment.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <TrustPill icon={<Wrench className="h-4 w-4" />} text="Fitment first" />
            <TrustPill icon={<ShieldCheck className="h-4 w-4" />} text="Secure checkout" />
            <TrustPill icon={<Truck className="h-4 w-4" />} text="NZ focused" />
          </div>

          <Link
            href="/shop"
            className="mt-6 inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-ink shadow-sm hover:border-ink"
          >
            Browse wiper products
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="self-center">
          <WiperFitmentFinder />
        </div>
      </section>
    </main>
  );
}

function TrustPill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex min-h-12 items-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-ink shadow-sm">
      <span className="text-signal">{icon}</span>
      <span>{text}</span>
    </div>
  );
}
