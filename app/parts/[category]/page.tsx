import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BatteryCharging, CheckCircle2, Filter, Lightbulb, Wrench } from "lucide-react";

const categoryDefinitions = {
  bulbs: {
    name: "Light Bulbs",
    description: "Headlight, fog, indicator and interior bulb fitment.",
    fields: ["Body or chassis", "Lamp position", "Low or high beam"],
    productHref: "/products/h11-headlight-license-plate-bulb-bundle",
    productLabel: "Browse current lighting products",
    icon: Lightbulb
  },
  batteries: {
    name: "Batteries",
    description: "Vehicle batteries matched by physical size, terminals and electrical requirements.",
    fields: ["Engine", "Start-stop system", "Terminal layout"],
    productHref: "/products/vehicle-fit-battery",
    productLabel: "View current battery product",
    icon: BatteryCharging
  },
  filters: {
    name: "Filters",
    description: "Oil, air, cabin and fuel filters matched to the correct vehicle application.",
    fields: ["Engine code or capacity", "Fuel type", "Filter position"],
    productHref: "/products/vehicle-fit-oil-filter",
    productLabel: "View current filter product",
    icon: Filter
  },
  suspension: {
    name: "Suspension Parts",
    description: "Shocks, struts, control arms and bushes matched by chassis and axle position.",
    fields: ["Chassis", "Drivetrain", "Front or rear position"],
    productHref: "/contact",
    productLabel: "Request suspension fitment help",
    icon: Wrench
  }
} as const;

type CategoryKey = keyof typeof categoryDefinitions;

export default async function PartCategoryPage({
  params,
  searchParams
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ make?: string; model?: string; year?: string }>;
}) {
  const { category } = await params;
  if (!(category in categoryDefinitions)) notFound();
  const definition = categoryDefinitions[category as CategoryKey];
  const vehicle = await searchParams;
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  const Icon = definition.icon;

  return (
    <main className="bg-[#F8FAFC]">
      <section className="border-b border-black/10 bg-ink text-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-signal">
            <Icon className="h-4 w-4" /> Category-specific fitment
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-5xl">Find {definition.name.toLowerCase()} for your vehicle</h1>
          <p className="mt-4 max-w-2xl text-base font-bold leading-7 text-white/72">{definition.description}</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-12">
        <div className="rounded-2xl border border-emerald-700/20 bg-emerald-50 p-5 shadow-sm sm:p-7">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" />
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Vehicle context received</p>
              <h2 className="mt-2 text-2xl font-black text-ink">{vehicleLabel || "Choose your vehicle on the homepage"}</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-steel">
                Make, model and year have carried across from the homepage. This category will use its own data source and matching rules.
              </p>
            </div>
          </div>
        </div>

        <aside className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm sm:p-7">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">Next confirmation</p>
          <h2 className="mt-2 text-xl font-black">Additional information required</h2>
          <ul className="mt-4 space-y-3">
            {definition.fields.map((field) => (
              <li key={field} className="flex items-center gap-3 text-sm font-bold text-ink">
                <span className="h-2 w-2 rounded-full bg-signal" /> {field}
              </li>
            ))}
          </ul>
          <p className="mt-5 rounded-lg bg-zinc-100 p-3 text-xs font-bold leading-5 text-steel">
            The dedicated {definition.name.toLowerCase()} database adapter is the next implementation step. No compatibility claim is shown until that source confirms a match.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <Link href={definition.productHref} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-black text-white hover:bg-black">
              {definition.productLabel}<ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/#vehicle-finder" className="inline-flex h-11 items-center justify-center rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-ink hover:border-ink">
              Change vehicle
            </Link>
          </div>
        </aside>
      </section>
    </main>
  );
}
