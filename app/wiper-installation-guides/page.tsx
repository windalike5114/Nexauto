import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, LifeBuoy, PlayCircle, Search } from "lucide-react";
import { blobMediaAssets } from "@/lib/blob-media-assets";

export const metadata: Metadata = {
  title: "Wiper Installation Guide Centre",
  description:
    "Find NexAutoParts wiper installation guides, adapter reference images, videos, safety notices and troubleshooting information."
};

export default function WiperInstallationGuidesPage() {
  return (
    <main>
      <section className="border-b border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Installation support</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-black leading-tight sm:text-5xl">Wiper Installation Guide Centre</h1>
          <div className="mt-5 max-w-3xl space-y-3 text-base font-semibold leading-8 text-steel">
            <p>Find the installation guide that matches your wiper arm connection.</p>
            <p>NexAutoParts supports multiple common adapter styles. Use the numbered reference below to find the guide that matches your supplied adapter.</p>
            <p>If you are unsure which guide applies to your vehicle, contact our support team before installation.</p>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8 grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <section className="rounded-lg border border-black/10 bg-[#F8FAFC] p-5">
              <div className="grid h-11 w-11 place-items-center rounded bg-signal text-white">
                <Search className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-2xl font-black">Find Your Guide Number</h2>
              <p className="mt-3 text-sm font-bold leading-7 text-steel">
                Match your supplied adapter or vehicle example to the numbered reference below. Then open the matching video guide using the same number.
              </p>
              <div className="mt-5 rounded border border-black/10 bg-white p-4 text-sm font-bold leading-7 text-steel">
                <p>Example: if your adapter matches reference 04, open Guide 04.</p>
                <p className="mt-2 text-ink">Do not force any fitting. Contact support if the adapter does not look correct.</p>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
              <div className="border-b border-black/10 p-5">
                <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Adapter reference</p>
                <h2 className="mt-2 text-2xl font-black">Adapter and Vehicle Guide Selector</h2>
                <p className="mt-3 text-sm font-bold leading-7 text-steel">
                  Vehicle examples are only a guide. Always compare the supplied adapter and contact support if unsure.
                </p>
              </div>
              <div className="max-h-[620px] overflow-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-ink text-white">
                    <tr>
                      <th className="px-4 py-3 font-black">No.</th>
                      <th className="px-4 py-3 font-black">Vehicle examples</th>
                      <th className="px-4 py-3 font-black">Wiper arm type</th>
                      <th className="px-4 py-3 font-black">Video guide</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10">
                    {adapterReferences.map((reference) => (
                      <tr key={reference.number} className="align-top">
                        <td className="px-4 py-4 font-mono text-lg font-black text-signal">{reference.number}</td>
                        <td className="px-4 py-4 font-bold leading-6 text-ink">{reference.vehicleExamples}</td>
                        <td className="px-4 py-4 font-bold text-steel">{reference.armType}</td>
                        <td className="px-4 py-4">
                          <a
                            href={getGuideVideoUrl(reference.number)}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded bg-ink px-4 text-xs font-black text-white transition hover:-translate-y-0.5 hover:bg-black"
                          >
                            <PlayCircle className="h-4 w-4" />
                            Guide {reference.number}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {adapterReferences.map((reference) => (
              <article key={reference.number} className="rounded-lg border border-black/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel">
                <p className="font-mono text-2xl font-black text-signal">{reference.number}</p>
                <h3 className="mt-2 font-black">{reference.armType}</h3>
                <p className="mt-2 min-h-12 text-xs font-bold leading-5 text-steel">{reference.vehicleExamples}</p>
                <a
                  href={getGuideVideoUrl(reference.number)}
                  className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded bg-signal px-3 text-xs font-black text-white transition hover:-translate-y-0.5 hover:bg-red-700"
                >
                  <PlayCircle className="h-4 w-4" />
                  Watch Guide {reference.number}
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:px-6 lg:grid-cols-3 lg:px-8">
          <GuidePanel
            title="Step-by-step fitting"
            points={[
              "Lift the wiper arm carefully away from the windscreen.",
              "Remove the old blade while supporting the arm.",
              "Compare the supplied adapter with the reference images.",
              "Attach the new blade until it locks firmly into place.",
              "Lower the arm gently and test with washer fluid."
            ]}
          />
          <GuidePanel
            title="Safety notices"
            icon="warning"
            points={[
              "Do not let the bare wiper arm snap back onto the glass.",
              "Check both blades are secure before driving.",
              "Do not force an adapter if it does not align cleanly.",
              "Contact support before installation if you are unsure."
            ]}
          />
          <GuidePanel
            title="Troubleshooting"
            points={[
              "Streaking can be caused by a dirty windscreen or dry testing.",
              "Skipping may indicate the blade is not seated correctly.",
              "Noise can occur if the protective sleeve was not removed.",
              "If the adapter does not lock, stop and contact support."
            ]}
          />
        </div>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Installation FAQ</p>
          <h2 className="mt-3 text-3xl font-black">Frequently Asked Questions</h2>
          <div className="mt-6 divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 bg-white">
            {installationFaqs.map((faq) => (
              <details key={faq.question} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-black">
                  {faq.question}
                  <span className="text-signal group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm font-bold leading-7 text-steel">{faq.answer}</p>
              </details>
            ))}
          </div>
          <div className="mt-8 rounded-lg border border-black/10 bg-[#F8FAFC] p-5">
            <h3 className="font-black">Need more help?</h3>
            <p className="mt-2 text-sm font-bold leading-6 text-steel">
              Send us your vehicle details and a photo of the wiper arm before fitting. We can help confirm the next step.
            </p>
            <Link href="/contact" className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded bg-signal px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-red-700">
              <LifeBuoy className="h-4 w-4" />
              Contact Fitment Support
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function GuidePanel({ title, points, icon }: { title: string; points: string[]; icon?: "warning" }) {
  return (
    <article className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-signal text-white">
        {icon === "warning" ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
      </div>
      <h2 className="mt-4 text-xl font-black">{title}</h2>
      <div className="mt-4 space-y-3">
        {points.map((point) => (
          <div key={point} className="flex gap-3 text-sm font-bold leading-6 text-steel">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
            <span>{point}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function getGuideVideoUrl(number: string) {
  const video = blobMediaAssets.installationGuides.videos.find((asset) => asset.number === number);
  if (!video) throw new Error(`Missing installation guide video: ${number}`);
  return video.url;
}

const adapterReferences = [
  {
    number: "01",
    vehicleExamples: "Selected European vehicles including Volvo S40, Mondeo, Peugeot 308/508, Land Rover Evoque",
    armType: "Push Button Arm 19 mm"
  },
  {
    number: "02",
    vehicleExamples: "Selected Chinese, Japanese and Korean vehicles with common U hook arms",
    armType: "U Hook Arm"
  },
  {
    number: "03",
    vehicleExamples: "Selected Focus, Skoda, Golf, Touran, Touareg, Benz E-class, Cayenne applications",
    armType: "Side Pin Arm"
  },
  {
    number: "04",
    vehicleExamples: "Selected Audi A4, Audi A5, Audi Q3, Audi Q5 and Volkswagen applications",
    armType: "Slim Push Button 16 mm"
  },
  {
    number: "05",
    vehicleExamples: "Selected BMW 5 Series, 6 Series, M5 and M6 applications",
    armType: "Top Lock Arm"
  },
  {
    number: "06",
    vehicleExamples: "Selected Audi A6, RS6, S5, S6 and Seat Altea applications",
    armType: "Claw Arm"
  },
  {
    number: "07",
    vehicleExamples: "Selected Peugeot 307, Renault Koleos, Volvo and new BMW applications",
    armType: "Pinch Tab Arm"
  },
  {
    number: "08",
    vehicleExamples: "Selected BMW 5 Series, BMW GT and BMW 7 Series applications",
    armType: "Side Pin Arm"
  },
  {
    number: "09",
    vehicleExamples: "Selected Audi A4/A6/A8, Aston Martin Rapide, Benz C-class and CLK-class applications",
    armType: "Pin Lock Arm"
  },
  {
    number: "10",
    vehicleExamples: "Selected Renault, BMW Mini, Citroen, Dacia, Fiat, Sandero and Peugeot Traveller applications",
    armType: "Bayonet Arm"
  },
  {
    number: "11",
    vehicleExamples: "Selected newer Mercedes-Benz applications",
    armType: "Mercedes-Benz style arm"
  },
  {
    number: "12",
    vehicleExamples: "Selected Toyota, Mazda, Lexus, Land Rover, Subaru, Jaguar and BMW X3/X4 applications",
    armType: "Push Button Arm"
  },
  {
    number: "13",
    vehicleExamples: "Selected Holden Colorado, Trailblazer and Ford Ecosport applications",
    armType: "Ecosport Arm"
  },
  {
    number: "14",
    vehicleExamples: "Selected MG ZS and Roewe RX3 applications",
    armType: "MG ZS Arm"
  },
  {
    number: "15",
    vehicleExamples: "Selected BMW Mini, BMW X2, Renault Kadjar and Renault Captur applications",
    armType: "BMW Mini Arm"
  },
  {
    number: "16",
    vehicleExamples: "Selected BMW 1/2 Series, newer Mercedes-Benz C-class and newer Audi A3 applications",
    armType: "Audi A3 style arm"
  }
];

const installationFaqs = [
  {
    question: "Do I need specialist tools?",
    answer: "Most wiper blade installations can be completed without specialist tools. Follow the adapter-specific guide and avoid forcing any fitting."
  },
  {
    question: "What if my supplied adapter looks different?",
    answer: "Stop before installation and contact NexAutoParts with your vehicle details and a clear photo of the wiper arm and adapter."
  },
  {
    question: "Can I test the blades on a dry windscreen?",
    answer: "Use washer fluid or water when testing. Dry testing can cause noise, skipping or unnecessary rubber wear."
  },
  {
    question: "Why does one blade look longer than the other?",
    answer: "Many vehicles use different driver-side and passenger-side lengths. Check your product page and vehicle fitment result before installation."
  }
];
