"use client";

import { FormEvent, useEffect, useState } from "react";

export function HomeNewsletterSignup() {
  const [email, setEmail] = useState("");
  const [sourceUrl, setSourceUrl] = useState("https://nexautoparts.co.nz");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setSourceUrl(window.location.href);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const nextEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setMessage({ type: "error", text: "Please enter a valid email address." });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Newsletter subscriber",
          email: nextEmail,
          partOrSku: "Newsletter",
          message: "Please subscribe this customer to NexAutoParts newsletter updates.",
          sourcePage: "Homepage newsletter",
          sourceUrl
        })
      });

      if (!response.ok) throw new Error("Newsletter signup failed.");

      setEmail("");
      setMessage({ type: "success", text: "Thanks. You're on the list." });
    } catch {
      setMessage({ type: "error", text: "We couldn't subscribe this email. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="home-newsletter-email" className="text-xs font-black uppercase tracking-[0.14em] text-white/78">
        Email address
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          id="home-newsletter-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          maxLength={254}
          placeholder="Enter your email"
          className="h-12 min-w-0 flex-1 rounded border border-white/15 bg-white px-4 text-base font-bold text-ink outline-none focus:border-signal sm:text-sm"
        />
        <button
          type="submit"
          disabled={submitting}
          className="h-12 rounded bg-signal px-6 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-red-700 disabled:bg-zinc-300"
        >
          {submitting ? "Subscribing..." : "Subscribe"}
        </button>
      </div>
      {message ? (
        <p className={`mt-3 text-sm font-bold ${message.type === "success" ? "text-emerald-300" : "text-red-200"}`}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
