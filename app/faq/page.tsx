import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQs",
  description: "Frequently asked questions about NexAutoParts orders, vehicle fitment, wiper blades, shipping, returns, and accounts."
};

const faqs = [
  ["How do I find the correct wiper blades?", "Use the vehicle finder on the homepage. Select your make, model, and year, then we will match the correct front pair and any rear blade option where data is available."],
  ["Do I need an account to order?", "No. You can complete checkout as a guest. After payment, you can optionally create an account using the same email to view order history and save vehicles."],
  ["Are prices in New Zealand Dollars?", "Yes. Prices are displayed and charged in NZD unless otherwise stated."],
  ["How quickly are orders dispatched?", "Most in-stock orders are processed within 1 business day after successful payment."],
  ["Can you help confirm fitment?", "Yes. Contact us with your vehicle details and any part information you already have, and our team will help where possible."],
  ["What if I receive the wrong item?", "Contact us as soon as possible. Once confirmed, we will arrange a replacement or refund according to our returns policy."]
];

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">FAQs</p>
      <h1 className="mt-3 text-4xl font-black">Frequently asked questions</h1>
      <div className="mt-8 grid gap-4">
        {faqs.map(([question, answer]) => (
          <article key={question} className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">{question}</h2>
            <p className="mt-3 leading-7 text-steel">{answer}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
