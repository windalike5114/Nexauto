import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
  description: "NexAutoParts guides for wiper blades, vehicle maintenance, seasonal driving, and buying replacement auto parts in New Zealand."
};

const articles = [
  {
    category: "Wiper Guides",
    title: "How to choose replacement wiper blades in New Zealand",
    excerpt: "A practical guide to using vehicle fitment, blade length, and connector handling to find the right wipers."
  },
  {
    category: "Vehicle Maintenance",
    title: "Simple checks before winter driving",
    excerpt: "Visibility, tyres, fluids, battery health, and basic maintenance checks for changing New Zealand conditions."
  },
  {
    category: "Buying Guides",
    title: "Why fitment data matters when buying auto parts online",
    excerpt: "How accurate vehicle information reduces guesswork and helps customers buy replacement parts with more confidence."
  }
];

export default function BlogPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Blog</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-black">Guides for better vehicle maintenance</h1>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {articles.map((article) => (
          <article key={article.title} className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">{article.category}</p>
            <h2 className="mt-3 text-xl font-black">{article.title}</h2>
            <p className="mt-3 leading-7 text-steel">{article.excerpt}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
