import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductConfigurator } from "@/components/product-configurator";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { BrakePadProductView } from "@/components/brake-pad-product-view";
import { formatMoney } from "@/lib/catalog";
import { productDetailContent, productImage } from "@/lib/product-content";
import { getProductAttributes, getProductBySlug, listCategories, listProductVariants } from "@/lib/queries/catalog";
import { getBrakePadDetail } from "@/lib/queries/brake-pad-catalog";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProductBySlug(id);

  if (!product) notFound();

  if (product.category === "filter") {
    notFound();
  }

  if (product.category === "brake-pad") {
    const detail = await getBrakePadDetail(product);
    if (!detail) notFound();
    return <BrakePadProductView detail={detail} />;
  }

  const [attributes, variants, categories] = await Promise.all([
    getProductAttributes(product.id),
    listProductVariants(product.id),
    listCategories()
  ]);
  const category = categories.find((entry) => entry.slug === product.category);
  const content = productDetailContent(product);
  const image = productImage(product);
  const allVariantsOutOfStock = variants.length > 0 && variants.every((variant) => variant.stock <= 0);
  const needsContactSupport = product.slug === "vehicle-fit-battery" || product.slug === "vehicle-fit-oil-filter";

  return (
    <main>
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-zinc-200 lg:aspect-auto lg:h-[400px]">
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
        </div>

        <section className="space-y-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">{category?.name ?? product.category}</p>
            <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">{product.name}</h1>
            <p className="mt-4 text-3xl font-black">
              {!product.purchasable ? "Coming soon" : needsContactSupport ? "Fitment enquiry" : formatMoney(product.price)}
            </p>
          </div>
          {!product.purchasable ? (
            <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
              <p className="text-sm font-black text-ink">Catalogue preview — purchasing is disabled.</p>
              <p className="mt-2 text-sm font-bold leading-6 text-steel">
                This product page is being reviewed for specifications, fitment, pricing, and stock. It cannot be added to the cart or purchased yet.
              </p>
              <Link
                href={`/contact?part=${encodeURIComponent(product.name)}`}
                className="mt-4 inline-flex h-11 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-black"
              >
                Ask about this product
              </Link>
            </section>
          ) : needsContactSupport ? (
            <section className="rounded-lg border border-signal/20 bg-[#F8FAFC] p-5">
              <p className="text-sm font-black text-ink">Vehicle-specific fitment requires confirmation.</p>
              <p className="mt-2 text-sm font-bold leading-6 text-steel">
                Contact us with your make, model, year, and engine details before ordering so we can confirm the correct part.
              </p>
              <Link
                href={`/contact?part=${encodeURIComponent(product.name)}`}
                className="mt-4 inline-flex h-11 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-black"
              >
                Contact Us
              </Link>
            </section>
          ) : null}
          {product.purchasable && !needsContactSupport ? <ProductConfigurator product={product} attributes={attributes} variants={variants} /> : null}
          {product.purchasable && !needsContactSupport && allVariantsOutOfStock ? (
            <p className="rounded-lg border border-black/10 bg-zinc-50 px-4 py-3 text-sm font-bold text-steel">
              This product is currently out of stock.
            </p>
          ) : null}
        </section>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">{content.kicker}</p>
            <h2 className="mt-1 text-2xl font-black sm:text-3xl">Product Specifications</h2>
            <p className="mt-3 leading-7 text-steel">{content.intro}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {content.highlights.map((item) => (
                <span key={item} className="rounded bg-zinc-100 px-3 py-2 text-sm font-bold text-steel">
                  {item}
                </span>
              ))}
            </div>
            {product.category === "wiper" ? <div className="mt-4"><WiperFitmentFinder compact /></div> : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {content.sections.map((section) => (
              <article key={section.title} className="rounded-lg border border-black/10 bg-zinc-50 p-5">
                <h3 className="text-lg font-black">{section.title}</h3>
                <p className="mt-3 leading-7 text-steel">{section.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
