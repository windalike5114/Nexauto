const sections = [
  {
    title: "Shipping",
    body: "Orders are prepared after payment confirmation. Shipping options and rates can be configured through Stripe Checkout or a future carrier integration."
  },
  {
    title: "Returns",
    body: "Unused items in resaleable condition may be eligible for return. Electrical parts and opened consumables may require review before approval."
  },
  {
    title: "Product fitment",
    body: "Customers should confirm visible specifications such as length, connector, base type, voltage, and position before ordering."
  },
  {
    title: "Payments",
    body: "Online payments are processed securely through Stripe. NexAuto does not store card details."
  }
];

export default function PolicyPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Policy</p>
      <h1 className="mt-3 text-4xl font-black">Shipping, returns, and product policy</h1>
      <div className="mt-8 space-y-4">
        {sections.map((section) => (
          <article key={section.title} className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">{section.title}</h2>
            <p className="mt-3 leading-7 text-steel">{section.body}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
