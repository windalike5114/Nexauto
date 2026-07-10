import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Policies",
  description: "NexAutoParts policy hub for shipping, returns, warranty, privacy, and terms and conditions."
};

const policies = [
  ["Shipping Information", "/shipping", "Processing, delivery coverage, tracking, and damaged delivery guidance."],
  ["Returns & Refunds", "/returns", "Change-of-mind returns, incorrect items, faulty products, and refund processing."],
  ["Warranty", "/warranty", "Warranty coverage, claim requirements, exclusions, and consumer rights."],
  ["Privacy Policy", "/privacy", "How customer, order, vehicle, and technical information is collected and used."],
  ["Terms & Conditions", "/terms", "Website use, pricing, orders, payment, shipping, returns, warranty, and compatibility."]
];

export default function PolicyPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Policies</p>
      <h1 className="mt-3 text-4xl font-black">Customer information and policies</h1>
      <p className="mt-4 max-w-3xl leading-8 text-steel">
        Find clear information about delivery, returns, warranty coverage, privacy, and terms for shopping with NexAutoParts.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {policies.map(([title, href, text]) => (
          <Link key={href} href={href as never} className="rounded-lg border border-black/10 bg-white p-6 shadow-sm hover:border-ink">
            <h2 className="text-xl font-black">{title}</h2>
            <p className="mt-3 leading-7 text-steel">{text}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
