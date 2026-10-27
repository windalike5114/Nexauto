import Link from "next/link";
import { BulbProductGallery } from "@/components/bulb-product-gallery";
import { BulbPurchase } from "@/components/bulb-purchase";
import { bulbCartItem, type BulbDetail } from "@/lib/bulbs";
import { formatMoney } from "@/lib/catalog";

export function BulbProductView({ detail }: { detail: BulbDetail }) {
  const jsonLd = {
    "@context": "https://schema.org", "@type": "Product",
    name: detail.title, sku: detail.sku, category: "Light Bulbs",
    description: [detail.subtitle, ...detail.features].join(" "),
    image: detail.images.map((src) => `https://nexautoparts.co.nz${src}`),
    offers: { "@type": "Offer", priceCurrency: "NZD", price: detail.priceNzd,
      url: `https://nexautoparts.co.nz/bulbs/${detail.sku}` }
  };
  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-8">
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <BulbProductGallery images={detail.images} title={detail.title} />
        </div>
        <section className="space-y-4">
          <header>
            <Link href="/shop?category=bulbs" className="text-xs font-black uppercase tracking-[0.16em] text-signal sm:text-sm sm:tracking-[0.18em]">Light Bulbs</Link>
            <h1 className="mt-2 text-2xl font-black leading-tight text-ink sm:mt-3 sm:text-4xl">{detail.title}</h1>
            <p className="mt-2 text-xl font-black leading-snug text-steel sm:text-2xl">{detail.subtitle}</p>
            <div className="mt-3 space-y-0.5 text-sm font-bold text-steel">
              <p>SKU: {detail.sku}</p>
            </div>
            <p className="mt-4 text-3xl font-black sm:text-4xl">{formatMoney(detail.priceNzd)}</p>
            {detail.packLabel ? <p className="mt-2 text-sm font-bold text-steel">{detail.packLabel}</p> : null}
          </header>
          <dl className="grid grid-cols-2 gap-2 rounded-lg border border-black/10 bg-zinc-50 p-4 sm:grid-cols-3">
            {detail.specifications.filter((spec) => ["Bulb model", "Voltage", "Power"].includes(spec.label)).map((spec) => (
              <div key={spec.label}><dt className="text-xs font-bold text-steel">{spec.label}</dt><dd className="mt-1 text-sm font-black text-ink">{spec.value}</dd></div>
            ))}
          </dl>
          <BulbPurchase item={bulbCartItem(detail, 1)} orderingEnabled={detail.orderingEnabled && (detail.inventoryQuantity === null || detail.inventoryQuantity > 0)} />
        </section>
      </section>
      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <h2 className="text-2xl font-black sm:text-3xl">Product Specifications</h2>
          <div className="mt-4 divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 bg-white">
            <details open className="p-4 sm:p-5">
              <summary className="cursor-pointer text-base font-black text-ink">Key Features &amp; Benefits</summary>
              <ul className="mt-4 list-disc space-y-3 pl-5 text-sm font-bold leading-6 text-steel">{detail.features.map((feature, index) => <li key={index}>{feature}</li>)}</ul>
            </details>
            <details open className="p-4 sm:p-5">
              <summary className="cursor-pointer text-base font-black text-ink">Technical Specifications · {detail.sku}</summary>
              <dl className="mt-4 overflow-hidden rounded-lg border border-black/10 text-sm font-bold">
                {detail.specifications.map((spec) => (
                  <div key={spec.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 border-b border-black/10 px-4 py-3 last:border-b-0 odd:bg-zinc-50">
                    <dt className="font-black text-ink">{spec.label}</dt><dd className="break-words text-right text-steel">{spec.value}</dd>
                  </div>
                ))}
                {detail.packLabel ? <div className="grid grid-cols-2 gap-4 px-4 py-3"><dt className="font-black">Pack size</dt><dd className="text-right text-steel">{detail.packLabel}</dd></div> : null}
              </dl>
            </details>
            <details className="p-4 sm:p-5"><summary className="cursor-pointer font-black">Installation Notes</summary><p className="mt-4 text-sm font-bold leading-6 text-steel">Switch off the lights and allow the bulb to cool. Follow the vehicle manufacturer&apos;s replacement procedure and avoid touching the glass of halogen or HID bulbs. Check the base, connector and electrical rating before installation.</p></details>
            <details className="p-4 sm:p-5"><summary className="cursor-pointer font-black">Shipping</summary><p className="mt-4 text-sm font-bold leading-6 text-steel">Orders are dispatched from Auckland. See our <Link href="/shipping" className="underline">shipping information</Link> for delivery details.</p></details>
            <details className="p-4 sm:p-5"><summary className="cursor-pointer font-black">Returns &amp; Warranty</summary><p className="mt-4 text-sm font-bold leading-6 text-steel">Check the bulb specifications before installation. See our <Link href="/returns" className="underline">returns policy</Link> and <Link href="/warranty" className="underline">warranty information</Link>.</p></details>
          </div>
        </div>
      </section>
    </main>
  );
}
