import { BadgeCheck, Boxes, Wrench } from "lucide-react";

export default function AboutPage() {
  return (
    <main>
      <section className="border-b border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">About us</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black sm:text-5xl">A practical auto parts store built around clean SKU data.</h1>
          <p className="mt-5 max-w-3xl leading-8 text-steel">
            NexAuto focuses on common automotive consumables first: wipers and bulbs. The platform is designed to expand into filters,
            brake pads, batteries, and vehicle fitment without rebuilding the shopping experience.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
        <Value icon={<Wrench className="h-5 w-5" />} title="Spec-first shopping" text="Products are selected by useful attributes such as length, connector, base type, and voltage." />
        <Value icon={<Boxes className="h-5 w-5" />} title="Variant stock" text="Each sellable SKU can carry its own price, stock, and attributes." />
        <Value icon={<BadgeCheck className="h-5 w-5" />} title="Ready to scale" text="The database already reserves room for fitment and future B2B workflows." />
      </section>
    </main>
  );
}

function Value({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <article className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
      <div className="grid h-11 w-11 place-items-center rounded bg-ink text-white">{icon}</div>
      <h2 className="mt-5 text-xl font-black">{title}</h2>
      <p className="mt-3 leading-7 text-steel">{text}</p>
    </article>
  );
}
