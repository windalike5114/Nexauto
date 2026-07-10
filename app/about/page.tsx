import type { Metadata } from "next";
import { BadgeCheck, HeartHandshake, Lightbulb, RefreshCw } from "lucide-react";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Learn about NexAutoParts, a New Zealand auto parts store focused on reliable products, honest support, and simple vehicle fitment guidance."
};

export default function AboutPage() {
  return (
    <main>
      <section className="border-b border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">About NexAutoParts</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-black sm:text-5xl">Reliable replacement parts backed by honest service and practical support.</h1>
          <div className="mt-6 max-w-4xl space-y-4 leading-8 text-steel">
            <p>
              Keeping your vehicle in good condition should be straightforward. At NexAutoParts, we are dedicated to making automotive maintenance easier by offering reliable replacement parts backed by honest service and practical support.
            </p>
            <p>
              Based in New Zealand, we understand the demands local roads and weather place on vehicles. That is why we focus on supplying quality products that deliver dependable performance, whether you are driving through busy city streets, rural highways, or changing seasonal conditions.
            </p>
            <p>
              As our business grows, our product range continues to expand beyond premium wiper blades to include filters, braking components, and other essential maintenance items.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-12 sm:px-6 md:grid-cols-2 lg:px-8">
        <Statement title="Our Mission" text="To help New Zealand drivers maintain their vehicles with confidence through quality products, trusted advice, and exceptional customer service." />
        <Statement title="Our Vision" text="To simplify automotive maintenance for every New Zealand driver by providing an easy-to-use online store with reliable products and expert support." />
      </section>

      <section className="border-t border-black/10 bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Our Values</p>
          <div className="mt-6 grid gap-5 md:grid-cols-4">
            <Value icon={<BadgeCheck className="h-5 w-5" />} title="Reliability" text="Customers should receive products they can depend on." />
            <Value icon={<HeartHandshake className="h-5 w-5" />} title="Honesty" text="Clear information, transparent policies, and fair pricing." />
            <Value icon={<Lightbulb className="h-5 w-5" />} title="Simplicity" text="Making it easy to find compatible automotive parts." />
            <Value icon={<RefreshCw className="h-5 w-5" />} title="Continuous Improvement" text="We keep improving our products, services, and website experience." />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-12 text-center sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Our Promise</p>
        <h2 className="mt-3 text-3xl font-black">Every customer deserves the same level of care.</h2>
        <p className="mt-4 leading-8 text-steel">
          Whether you are replacing a single wiper blade or purchasing multiple maintenance items, we are committed to quality products, fair prices, accurate fitment guidance, fast dispatch, and friendly support.
        </p>
      </section>
    </main>
  );
}

function Statement({ title, text }: { title: string; text: string }) {
  return (
    <article className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-black">{title}</h2>
      <p className="mt-3 leading-7 text-steel">{text}</p>
    </article>
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
