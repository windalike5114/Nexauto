"use client";

import { useEffect, useState } from "react";

type ContactFormProps = {
  sourcePage: string;
  productName?: string;
  productSku?: string;
  defaultPartOrSku?: string;
};

const successMessage = "Thanks for getting in touch. We've received your enquiry and will respond as soon as possible.";
const errorMessage = "We couldn't send your enquiry. Please try again or email support@nexautoparts.co.nz.";

export function ContactForm({ sourcePage, productName, productSku, defaultPartOrSku = "" }: ContactFormProps) {
  const [sourceUrl, setSourceUrl] = useState("https://nexautoparts.co.nz");
  const [partOrSku, setPartOrSku] = useState(defaultPartOrSku);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    setSourceUrl(window.location.href);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setStatus(null);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const message = String(formData.get("message") ?? "").trim();
    const company = String(formData.get("company") ?? "");

    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
      setStatus({ type: "error", message: "Please enter your name, a valid email address, and a message." });
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          partOrSku,
          message,
          company,
          sourcePage,
          sourceUrl,
          productName,
          productSku
        })
      });

      if (!response.ok) throw new Error("Contact request failed.");

      setStatus({ type: "success", message: successMessage });
      event.currentTarget.reset();
      setPartOrSku(defaultPartOrSku);
    } catch {
      setStatus({ type: "error", message: errorMessage });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-panel sm:p-6">
      <h2 className="text-xl font-black">Message us</h2>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="hidden">
          <label>
            Company
            <input name="company" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <FormField id="contact-name" label="Name">
          <input
            id="contact-name"
            name="name"
            required
            maxLength={120}
            className="mt-2 h-12 w-full rounded border border-black/10 px-3 text-base outline-none focus:border-ink"
            placeholder="Your name"
          />
        </FormField>
        <FormField id="contact-email" label="Email">
          <input
            id="contact-email"
            name="email"
            type="email"
            required
            maxLength={254}
            className="mt-2 h-12 w-full rounded border border-black/10 px-3 text-base outline-none focus:border-ink"
            placeholder="you@example.com"
          />
        </FormField>
        <FormField id="contact-part" label="Part or SKU">
          <input
            id="contact-part"
            name="partOrSku"
            value={partOrSku}
            onChange={(event) => setPartOrSku(event.target.value)}
            maxLength={160}
            className="mt-2 h-12 w-full rounded border border-black/10 px-3 text-base outline-none focus:border-ink"
            placeholder="Enter a part name or SKU, if applicable"
          />
        </FormField>
        <FormField id="contact-message" label="How can we help?">
          <textarea
            id="contact-message"
            name="message"
            required
            maxLength={2000}
            className="mt-2 min-h-[140px] w-full rounded border border-black/10 p-3 text-base outline-none focus:border-ink"
            placeholder="Tell us how we can help"
          />
        </FormField>
        {status ? (
          <div
            className={`rounded border p-3 text-sm font-bold ${
              status.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-signal/30 bg-red-50 text-signal"
            }`}
          >
            {status.message}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="h-12 w-full rounded bg-signal px-5 font-black text-white transition hover:bg-red-700 disabled:bg-zinc-300"
        >
          {submitting ? "Sending..." : "Send enquiry"}
        </button>
      </form>
    </section>
  );
}

function FormField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-sm font-black text-ink">{label}</span>
      {children}
    </label>
  );
}
