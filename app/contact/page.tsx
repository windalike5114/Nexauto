import { Clock, Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { ContactForm } from "@/components/forms/contact-form";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Contact NexAutoParts for help with vehicle fitment, orders, shipping, returns, warranty claims, and auto parts support."
};

export default function ContactPage() {
  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
      <section>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Contact us</p>
        <h1 className="mt-3 text-4xl font-black sm:text-5xl">Need help choosing a part?</h1>
        <p className="mt-5 leading-8 text-steel">
          Send your vehicle details, product type, visible specification, and any SKU or part number you already have. Our New Zealand-based team will help where possible before or after purchase.
        </p>
        <div className="mt-8 grid gap-4">
          <ContactItem icon={<MapPin className="h-5 w-5" />} title="Location" text="Auckland, New Zealand" />
          <ContactItem icon={<Phone className="h-5 w-5" />} title="Phone" text="09-000 0000" />
          <ContactItem icon={<Mail className="h-5 w-5" />} title="Email" text="support@nexautoparts.co.nz" />
          <ContactItem icon={<Clock className="h-5 w-5" />} title="Hours" text="Monday - Friday / 9:00 AM - 5:00 PM" />
        </div>
      </section>

      <ContactForm sourcePage="Contact page" />
    </main>
  );
}

function ContactItem({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <div className="grid h-10 w-10 place-items-center rounded bg-mint/10 text-mint">{icon}</div>
      <div>
        <p className="font-black">{title}</p>
        <p className="text-sm text-steel">{text}</p>
      </div>
    </div>
  );
}
