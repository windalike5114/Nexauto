import Link from "next/link";
import { Clock, Mail, MapPin } from "lucide-react";

const footerGroups = [
  {
    title: "Shop",
    links: [
      ["Shop All", "/shop"],
      ["Wiper Blades", "/shop"],
      ["Vehicle Finder", "/"],
      ["New Arrivals", "/shop"]
    ]
  },
  {
    title: "Customer Care",
    links: [
      ["Shipping Information", "/shipping"],
      ["Returns & Refunds", "/returns"],
      ["Warranty", "/warranty"],
      ["FAQs", "/faq"],
      ["Contact Us", "/contact"],
      ["Track Your Order", "/account"]
    ]
  },
  {
    title: "Company",
    links: [
      ["About Us", "/about"],
      ["Blog", "/blog"],
      ["Privacy Policy", "/privacy"],
      ["Terms & Conditions", "/terms"]
    ]
  }
];

export function SiteFooter() {
  return (
    <footer className="border-t border-black/10 bg-ink text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-5 lg:px-8">
        <section className="lg:col-span-2">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded bg-white text-sm font-black text-ink">NX</span>
            <span className="text-lg font-black">NexAutoParts</span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-7 text-white/70">
            NexAutoParts is committed to providing quality automotive replacement parts and excellent customer service across New Zealand.
          </p>
          <div className="mt-5 space-y-3 text-sm text-white/70">
            <p className="flex gap-3">
              <MapPin className="mt-0.5 h-4 w-4 text-signal" />
              Auckland, New Zealand
            </p>
            <p className="flex gap-3">
              <Mail className="mt-0.5 h-4 w-4 text-signal" />
              support@nexautoparts.co.nz
            </p>
            <p className="flex gap-3">
              <Clock className="mt-0.5 h-4 w-4 text-signal" />
              Monday - Friday / 9:00 AM - 5:00 PM
            </p>
          </div>
        </section>

        {footerGroups.map((group) => (
          <section key={group.title}>
            <h3 className="font-black">{group.title}</h3>
            <div className="mt-4 grid gap-2 text-sm text-white/70">
              {group.links.map(([label, href]) => (
                <Link key={href + label} href={href as never} className="hover:text-white">
                  {label}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-xs font-bold text-white/55 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>(c) 2026 NexAutoParts. All rights reserved.</span>
          <span>Secure checkout powered by Stripe.</span>
        </div>
      </div>
    </footer>
  );
}
