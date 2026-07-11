import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarDays, Clock } from "lucide-react";
import { blogArticles, getBlogArticle, getRelatedBlogArticles } from "@/lib/blog";

const siteUrl = "https://nexautoparts.co.nz";

type BlogArticlePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return blogArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: BlogArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getBlogArticle(slug);

  if (!article) {
    return {
      title: "Blog Article",
      description: "NexAutoParts wiper blade guides and vehicle maintenance tips."
    };
  }

  return {
    title: article.seoTitle,
    description: article.description,
    alternates: {
      canonical: `/blog/${article.slug}`
    },
    openGraph: {
      title: article.seoTitle,
      description: article.description,
      url: `${siteUrl}/blog/${article.slug}`,
      type: "article",
      publishedTime: article.publishedAt
    }
  };
}

export default async function BlogArticlePage({ params }: BlogArticlePageProps) {
  const { slug } = await params;
  const article = getBlogArticle(slug);

  if (!article) notFound();

  const relatedArticles = getRelatedBlogArticles(article.slug);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    dateModified: article.publishedAt,
    author: {
      "@type": "Organization",
      name: "NexAutoParts"
    },
    publisher: {
      "@type": "Organization",
      name: "NexAutoParts"
    },
    mainEntityOfPage: `${siteUrl}/blog/${article.slug}`
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <article>
        <header className="border-b border-black/10 bg-[#F8FAFC]">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
            <Link href="/blog" className="text-sm font-black text-signal hover:text-ink">
              Blog
            </Link>
            <p className="mt-5 text-sm font-black uppercase tracking-[0.18em] text-signal">{article.category}</p>
            <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">{article.title}</h1>
            <p className="mt-5 text-lg font-semibold leading-8 text-steel">{article.description}</p>
            <div className="mt-6 flex flex-wrap gap-4 text-sm font-bold text-steel">
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-signal" />
                {formatDate(article.publishedAt)}
              </span>
              <span className="inline-flex items-center gap-2">
                <Clock className="h-4 w-4 text-signal" />
                {article.readingMinutes} min read
              </span>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8">
          <div className="mx-auto w-full max-w-3xl">
            <div className="space-y-5 text-base font-semibold leading-8 text-steel">
              {article.intro.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>

            <div className="mt-10 space-y-10">
              {article.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="text-2xl font-black leading-snug text-ink">{section.heading}</h2>
                  {section.paragraphs ? (
                    <div className="mt-4 space-y-4 text-base font-semibold leading-8 text-steel">
                      {section.paragraphs.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                    </div>
                  ) : null}
                  {section.bullets ? (
                    <ul className="mt-4 grid gap-2 text-base font-semibold leading-7 text-steel">
                      {section.bullets.map((item) => (
                        <li key={item} className="rounded border border-black/10 bg-white px-4 py-3 shadow-sm">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {section.steps ? (
                    <ol className="mt-4 grid gap-2 text-base font-semibold leading-7 text-steel">
                      {section.steps.map((item, index) => (
                        <li key={item} className="rounded border border-black/10 bg-white px-4 py-3 shadow-sm">
                          <span className="mr-2 font-black text-signal">{index + 1}.</span>
                          {item}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </section>
              ))}
            </div>
          </div>

          <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
            <section className="rounded-lg border border-black/10 bg-ink p-5 text-white shadow-panel">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-white/60">Need new wipers?</p>
              <h2 className="mt-3 text-2xl font-black">Find the correct blades for your vehicle</h2>
              <p className="mt-3 text-sm font-semibold leading-7 text-white/70">
                Use the NexAutoParts vehicle finder to check the recommended front wiper blade pair before ordering.
              </p>
              <Link href="/#vehicle-finder" className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-signal px-4 text-sm font-black text-white hover:bg-red-700">
                Find My Wipers
                <ArrowRight className="h-4 w-4" />
              </Link>
            </section>

            <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
              <h2 className="font-black">Related guides</h2>
              <div className="mt-4 grid gap-4">
                {relatedArticles.map((related) => (
                  <Link key={related.slug} href={`/blog/${related.slug}` as never} className="group block rounded border border-black/10 p-4 hover:border-signal">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">{related.category}</p>
                    <h3 className="mt-2 font-black leading-snug group-hover:text-signal">{related.title}</h3>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-black/10 bg-[#F8FAFC] p-5">
              <h2 className="font-black">Browse blade sizes</h2>
              <p className="mt-2 text-sm font-semibold leading-7 text-steel">
                Already know your sizes? View available front wiper blade pair combinations.
              </p>
              <Link href="/shop" className="mt-4 inline-flex text-sm font-black text-signal hover:text-ink">
                Browse Wiper Blades
              </Link>
            </section>
          </aside>
        </div>
      </article>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00+12:00`));
}
