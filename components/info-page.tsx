import Link from "next/link";

export function InfoPage({
  eyebrow,
  title,
  intro,
  children
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">{eyebrow}</p>
      <h1 className="mt-3 text-4xl font-black sm:text-5xl">{title}</h1>
      <p className="mt-5 leading-8 text-steel">{intro}</p>
      <div className="mt-8 space-y-4">{children}</div>
    </main>
  );
}

export function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black">{title}</h2>
      <div className="mt-3 space-y-3 leading-7 text-steel [&_ul]:list-disc [&_ul]:pl-5">{children}</div>
    </article>
  );
}

export function HelpCta() {
  return (
    <section className="rounded-lg border border-black/10 bg-ink p-6 text-white shadow-sm">
      <h2 className="text-xl font-black">Need Help?</h2>
      <p className="mt-3 leading-7 text-white/75">
        If you have any questions about your order, delivery, returns, or warranty coverage, our customer support team is happy to help.
      </p>
      <Link href="/contact" className="mt-5 inline-flex h-11 items-center rounded bg-signal px-5 text-sm font-black text-white hover:bg-red-700">
        Contact Us
      </Link>
    </section>
  );
}
