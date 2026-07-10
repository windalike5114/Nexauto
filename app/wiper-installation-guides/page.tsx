import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, LifeBuoy, PlayCircle } from "lucide-react";
import { blobMediaAssets } from "@/lib/blob-media-assets";

export const metadata: Metadata = {
  title: "Wiper Installation Guide Centre",
  description:
    "Find NexAutoParts wiper installation guides, adapter reference images, videos, safety notices and troubleshooting information."
};

const guideCards = [
  { name: "Adapter reference 1", image: "nexautoclip1", video: "topstar-01" },
  { name: "Adapter reference 2", image: "nexautoclip11", video: "topstar-02" },
  { name: "Adapter reference 3", image: "nexautoclip13", video: "topstar-04" },
  { name: "Adapter reference 4", image: "nexautoclip2", video: "topstar-07" },
  { name: "Adapter reference 5", image: "nexautoclip4", video: "topstar-08" },
  { name: "Adapter reference 6", image: "nexautoclip7", video: "topstar-11" },
  { name: "Adapter reference 7", image: "nexautoclip8", video: "topstar-13" }
];

export default function WiperInstallationGuidesPage() {
  return (
    <main>
      <section className="border-b border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Installation support</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-black leading-tight sm:text-5xl">Wiper Installation Guide Centre</h1>
          <div className="mt-5 max-w-3xl space-y-3 text-base font-semibold leading-8 text-steel">
            <p>Find the installation guide that matches your wiper arm connection.</p>
            <p>NexAutoParts supports multiple common adapter styles. Compare your supplied adapter with the images below and select the corresponding installation guide.</p>
            <p>If you are unsure which guide applies to your vehicle, contact our support team before installation.</p>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {guideCards.map((guide) => (
              <article key={guide.name} className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
                <div className="relative aspect-[4/3] bg-white">
                  <Image
                    src={getImageUrl(guide.image)}
                    alt={`${guide.name} image`}
                    fill
                    className="object-contain p-6"
                    sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                  />
                </div>
                <div className="border-t border-black/10 p-5">
                  <h2 className="text-xl font-black">{guide.name}</h2>
                  <p className="mt-2 text-sm font-bold leading-6 text-steel">
                    Match this reference with the adapter supplied in your order, then watch the guide before fitting.
                  </p>
                  <video className="mt-4 aspect-video w-full rounded bg-black" controls preload="metadata">
                    <source src={getVideoUrl(guide.video)} type="video/mp4" />
                  </video>
                  <a
                    href={getVideoUrl(guide.video)}
                    className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded bg-ink px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-black"
                  >
                    <PlayCircle className="h-4 w-4" />
                    Open installation guide
                  </a>
                </div>
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

function getImageUrl(name: string) {
  const image = blobMediaAssets.images.find((asset) => asset.name === name);
  if (!image) throw new Error(`Missing Blob image asset: ${name}`);
  return image.url;
}

function getVideoUrl(name: string) {
  const video = blobMediaAssets.videos.find((asset) => asset.name === name);
  if (!video) throw new Error(`Missing Blob video asset: ${name}`);
  return video.url;
}

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
