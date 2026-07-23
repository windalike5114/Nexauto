import Image from "next/image";
import { PlayCircle, ShieldCheck, Truck, Wrench } from "lucide-react";
import { notFound } from "next/navigation";
import { ProductConfigurator } from "@/components/product-configurator";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { formatMoney } from "@/lib/catalog";
import { productDetailContent, productImage } from "@/lib/product-content";
import { getProductAttributes, getProductBySlug, listCategories, listProductVariants } from "@/lib/queries/catalog";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProductBySlug(id);

  if (!product) notFound();

  const [attributes, variants, categories] = await Promise.all([
    getProductAttributes(product.id),
    listProductVariants(product.id),
    listCategories()
  ]);
  const category = categories.find((entry) => entry.slug === product.category);
  const content = productDetailContent(product);
  const image = productImage(product);

  return (
    <main>
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-zinc-200">
            {image ? (
              <Image
                src={image}
                alt={product.name}
                fill
                priority
                className={product.category === "wiper" || product.category === "bulb" ? "object-contain p-6" : "object-cover"}
                sizes="(min-width: 1024px) 50vw, 100vw"
              />
            ) : (
              <div className="grid h-full place-items-center font-black text-steel">No image</div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MediaTile icon={<Truck className="h-4 w-4" />} text="Dispatch" />
            <MediaTile icon={<ShieldCheck className="h-4 w-4" />} text="Secure pay" />
            <MediaTile icon={<Wrench className="h-4 w-4" />} text="SKU fit" />
          </div>
        </div>

        <section className="space-y-6">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">{category?.name ?? product.category}</p>
            <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">{product.name}</h1>
            <p className="mt-4 text-lg leading-8 text-steel">{product.description}</p>
            <p className="mt-5 text-3xl font-black">{formatMoney(product.price)}</p>
          </div>
          <ProductConfigurator product={product} attributes={attributes} variants={variants} />
          {product.category === "wiper" ? <WiperFitmentFinder compact /> : null}
        </section>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">{content.kicker}</p>
            <h2 className="mt-3 text-3xl font-black">Product details</h2>
            <p className="mt-4 leading-8 text-steel">{content.intro}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {content.highlights.map((item) => (
                <span key={item} className="rounded bg-zinc-100 px-3 py-2 text-sm font-bold text-steel">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {content.sections.map((section) => (
              <article key={section.title} className="rounded-lg border border-black/10 bg-zinc-50 p-5">
                <h3 className="text-lg font-black">{section.title}</h3>
                <p className="mt-3 leading-7 text-steel">{section.body}</p>
              </article>
            ))}
            <article className="rounded-lg border border-black/10 bg-ink p-5 text-white">
              <div className="flex items-center gap-3">
                <PlayCircle className="h-6 w-6 text-signal" />
                <h3 className="text-lg font-black">Installation overview</h3>
              </div>
              <p className="mt-3 leading-7 text-white/75">
                {product.videoUrl
                  ? "Video link is available for installation notes, connector checks, and buyer confidence."
                  : "A short product walkthrough can sit here for installation notes, connector checks, and buyer confidence."}
              </p>
              {product.videoUrl ? (
                <a
                  href={product.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex h-10 items-center rounded bg-white px-4 text-sm font-black text-ink"
                >
                  Open video
                </a>
              ) : null}
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}

function MediaTile({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex min-h-16 flex-col items-center justify-center gap-1 rounded border border-black/10 bg-white text-sm font-black text-steel">
      {icon}
      <span>{text}</span>
    </div>
  );
}
