import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { blogArticles } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Wiper Blade Guides and Vehicle Maintenance Tips",
  description:
    "Read NexAutoParts guides for choosing the correct wiper blade size, replacing worn wipers, and solving common windscreen wiper problems in New Zealand."
};

export default function BlogPage() {
  return (
    <main>
      <section className="border-b border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">NexAutoParts Blog</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-black leading-tight sm:text-5xl">
            Wiper blade guides for New Zealand drivers
          </h1>
          <p className="mt-4 max-w-3xl text-base font-semibold leading-8 text-steel">
            Practical advice for choosing the right windscreen wipers, checking blade wear, and fixing common wiping problems before the next heavy rain.
          </p>
          <Link
            href="/#vehicle-finder"
            className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-signal px-5 text-sm font-black text-white shadow-lg shadow-red-900/15 transition hover:-translate-y-0.5 hover:bg-red-700"
          >
            Find Wipers for My Vehicle
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-5 md:grid-cols-3">
          {blogArticles.map((article) => (
            <article key={article.slug} className="flex h-full flex-col rounded-lg border border-black/10 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-panel">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">{article.category}</p>
              <h2 className="mt-3 text-xl font-black leading-snug">
                <Link href={`/blog/${article.slug}` as never} className="hover:text-signal">
                  {article.title}
                </Link>
              </h2>
              <p className="mt-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-steel">
                <Clock className="h-4 w-4" />
                {article.readingMinutes} min read
              </p>
              <p className="mt-4 grow text-sm font-semibold leading-7 text-steel">{article.description}</p>
              <Link href={`/blog/${article.slug}` as never} className="mt-5 inline-flex items-center gap-2 text-sm font-black text-signal hover:text-ink">
                Read guide
                <ArrowRight className="h-4 w-4" />
              </Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
