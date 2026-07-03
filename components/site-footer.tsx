import Link from "next/link";
import { Mail, MapPin, Phone, Clock } from "lucide-react";

const categories = [
  ["Wipers", "/shop?category=wiper"],
  ["Bulbs", "/shop?category=bulb"],
  ["Brake Pads", "/shop?category=brake-pad"],
  ["Filters", "/shop?category=filter"],
  ["Batteries", "/shop?category=battery"]
];

export function SiteFooter() {
  return (
    <footer className="border-t border-black/10 bg-ink text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <section>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded bg-white text-sm font-black text-ink">NX</span>
            <span className="text-lg font-black">NexAuto</span>
          </div>
          <p className="mt-4 text-sm leading-7 text-white/70">
            Online automotive consumables store for spec-first replacement parts, built for retail and future trade accounts.
          </p>
        </section>

        <section>
          <h3 className="font-black">Contact Info</h3>
          <div className="mt-4 space-y-3 text-sm text-white/70">
            <p className="flex gap-3">
              <MapPin className="mt-0.5 h-4 w-4 text-signal" />
              Auckland, New Zealand
            </p>
            <p className="flex gap-3">
              <Phone className="mt-0.5 h-4 w-4 text-signal" />
              09-000 0000
            </p>
            <p className="flex gap-3">
              <Mail className="mt-0.5 h-4 w-4 text-signal" />
              sales@nexauto.co.nz
            </p>
            <p className="flex gap-3">
              <Clock className="mt-0.5 h-4 w-4 text-signal" />
              Mon - Fri / 9:00 AM - 5:00 PM
            </p>
          </div>
        </section>

        <section>
          <h3 className="font-black">Customer Service</h3>
          <div className="mt-4 grid gap-2 text-sm text-white/70">
            <Link href="/about" className="hover:text-white">About us</Link>
            <Link href="/contact" className="hover:text-white">Contact us</Link>
            <Link href="/policy" className="hover:text-white">Shipping & returns</Link>
            <Link href="/account" className="hover:text-white">My account</Link>
          </div>
        </section>

        <section>
          <h3 className="font-black">Product Category</h3>
          <div className="mt-4 grid gap-2 text-sm text-white/70">
            {categories.map(([label, href]) => (
              <Link key={href} href={href as never} className="hover:text-white">
                {label}
              </Link>
            ))}
          </div>
        </section>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-xs font-bold text-white/55 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>NexAuto NZ © 2026. All rights reserved.</span>
          <span>Secure checkout powered by Stripe.</span>
        </div>
      </div>
    </footer>
  );
}
