"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ArrowLeft, CheckCircle2, Loader2, MapPin, Search, ShieldCheck } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import { formatMoney } from "@/lib/catalog";
import { calculateCartPricing, calculateOrderTotals } from "@/lib/pricing";
import type { CheckoutShippingAddress } from "@/lib/domain/checkout/shipping-address";

type GeoapifySuggestion = {
  placeId: string;
  formatted: string;
  line1: string;
  line2?: string;
  suburb?: string;
  city: string;
  region?: string;
  postcode: string;
};

const initialAddress: CheckoutShippingAddress = {
  recipientName: "",
  phone: "",
  line1: "",
  line2: "",
  suburb: "",
  city: "",
  region: "",
  postcode: "",
  country: "NZ",
  source: "manual",
  formatted: ""
};

export default function CheckoutPage() {
  const {
    items,
    accountEmail,
    couponCode,
    couponDiscount,
    couponDraft,
    applyCoupon,
    welcomeRewardStatus,
    welcomeRewardDiscount,
    getStableCheckoutRequestId
  } = useCart();
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState<CheckoutShippingAddress>(initialAddress);
  const [addressQuery, setAddressQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeoapifySuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [autocompleteConfigured, setAutocompleteConfigured] = useState(true);
  const [addressError, setAddressError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const cacheRef = useRef(new Map<string, GeoapifySuggestion[]>());
  const pricing = calculateCartPricing(items);
  const totals = calculateOrderTotals(pricing, couponDiscount + welcomeRewardDiscount);
  const selectedVehicle = getSelectedVehicle(items);
  const selectedFormatted = address.formatted ?? "";

  useEffect(() => {
    if (accountEmail && !email) setEmail(accountEmail);
  }, [accountEmail, email]);

  useEffect(() => {
    const query = addressQuery.trim();
    if (query.length < 4 || query === selectedFormatted) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    const cacheKey = query.toLowerCase();
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setSuggestions(cached);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const params = new URLSearchParams({
          q: query
        });
        const response = await fetch(`/api/address/autocomplete?${params.toString()}`, {
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Address lookup failed.");
        const data = (await response.json()) as { configured?: boolean; suggestions?: GeoapifySuggestion[] };
        setAutocompleteConfigured(data.configured !== false);
        const nextSuggestions = data.suggestions ?? [];
        cacheRef.current.set(cacheKey, nextSuggestions);
        setSuggestions(nextSuggestions);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingSuggestions(false);
      }
    }, 450);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [addressQuery, selectedFormatted]);

  const lineItems = useMemo(() => items.map((item) => ({ ...item, lineTotal: item.price * item.qty })), [items]);

  async function continueToPayment() {
    setSubmitError("");
    setAddressError("");

    if (!items.length || submitting) return;

    if (couponDraft.trim() && !couponCode) {
      await applyCoupon();
      setSubmitError("Coupon checked. Please review the cart total, then continue to payment.");
      return;
    }

    const validationError = getFormValidationError(email, address);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-checkout-request-id": getStableCheckoutRequestId() },
        body: JSON.stringify({
          items,
          customer: { email: email.trim() },
          shippingAddress: normalizeAddress(address),
          couponCode: couponCode || undefined,
          welcomeRewardApplied: welcomeRewardStatus === "applied"
        })
      });
      const data = await readCheckoutResponse(response);

      if (response.ok && data.url) {
        window.location.href = data.url;
        return;
      }

      setSubmitError(data.error ?? "Checkout could not be started. Please try again.");
    } catch {
      setSubmitError("Checkout could not be started. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function selectSuggestion(suggestion: GeoapifySuggestion) {
    const nextAddress: CheckoutShippingAddress = {
      ...address,
      line1: suggestion.line1,
      line2: suggestion.line2 ?? "",
      suburb: suggestion.suburb ?? "",
      city: suggestion.city,
      region: suggestion.region ?? "",
      postcode: suggestion.postcode,
      country: "NZ",
      source: "geoapify",
      formatted: suggestion.formatted,
      placeId: suggestion.placeId
    };
    setAddress(nextAddress);
    setAddressQuery(suggestion.formatted);
    setSuggestions([]);
    setAddressError("");
  }

  if (!items.length) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-black/10 bg-white p-8 text-center shadow-panel">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Checkout</p>
          <h1 className="mt-3 text-3xl font-black text-ink">Your cart is empty</h1>
          <p className="mt-3 text-sm font-bold text-steel">Add the correct parts first, then return here to confirm delivery.</p>
          <Link href="/shop" className="mt-6 inline-flex h-11 items-center justify-center rounded bg-ink px-5 text-sm font-black text-white hover:bg-black">
            Browse parts
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-[#F8FAFC]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/cart" className="inline-flex items-center gap-2 text-sm font-black text-steel hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          Back to cart
        </Link>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-panel sm:p-7">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Delivery details</p>
            <h1 className="mt-2 text-3xl font-black text-ink sm:text-4xl">Confirm your NZ shipping address</h1>
            <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-steel">
              Enter the delivery address here. Wallet addresses from Apple Pay or other payment methods are not used for fulfilment.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <TextField label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" required />
              <TextField label="Recipient name" value={address.recipientName} onChange={(value) => setAddressField("recipientName", value, setAddress)} autoComplete="name" required />
              <TextField label="Phone" type="tel" value={address.phone} onChange={(value) => setAddressField("phone", value, setAddress)} autoComplete="tel" required />
            </div>

            <div className="relative mt-5">
              <label htmlFor="address-search" className="text-xs font-black uppercase tracking-[0.14em] text-steel">
                Find your address
              </label>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
                <input
                  id="address-search"
                  value={addressQuery}
                  onChange={(event) => {
                    setAddressQuery(event.target.value);
                    setAddressField("source", "manual", setAddress);
                  }}
                  placeholder="Start typing your NZ address"
                  autoComplete="street-address"
                  className="h-12 w-full rounded-lg border border-black/10 bg-white pl-10 pr-11 text-sm font-bold text-ink outline-none focus:border-ink"
                />
                {loadingSuggestions ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-steel" /> : null}
              </div>
              {!autocompleteConfigured ? (
                <p className="mt-2 text-xs font-bold text-steel">Manual entry is available. Add GEOAPIFY_API_KEY to enable NZ address suggestions.</p>
              ) : null}
              {suggestions.length ? (
                <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-black/10 bg-white shadow-xl">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.placeId}
                      type="button"
                      onClick={() => selectSuggestion(suggestion)}
                      className="flex w-full items-start gap-3 border-b border-black/5 px-4 py-3 text-left text-sm font-bold text-ink last:border-b-0 hover:bg-zinc-50"
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                      <span>{suggestion.formatted}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {addressError ? <p className="mt-2 text-xs font-bold text-signal">{addressError}</p> : null}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <TextField label="Address line 1" value={address.line1} onChange={(value) => setAddressField("line1", value, setAddress)} autoComplete="address-line1" required />
              <TextField label="Address line 2" value={address.line2 ?? ""} onChange={(value) => setAddressField("line2", value, setAddress)} autoComplete="address-line2" />
              <TextField label="Suburb" value={address.suburb ?? ""} onChange={(value) => setAddressField("suburb", value, setAddress)} autoComplete="address-level3" />
              <TextField label="City / town" value={address.city} onChange={(value) => setAddressField("city", value, setAddress)} autoComplete="address-level2" required />
              <TextField label="Region" value={address.region ?? ""} onChange={(value) => setAddressField("region", value, setAddress)} autoComplete="address-level1" />
              <TextField label="Postcode" value={address.postcode} onChange={(value) => setAddressField("postcode", value, setAddress)} autoComplete="postal-code" required />
            </div>

            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold leading-6 text-emerald-900">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
                <p>Stripe will securely handle payment. This delivery address stays attached to your NexAutoParts order for dispatch.</p>
              </div>
            </div>

            {submitError ? <p className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-bold text-signal">{submitError}</p> : null}
          </section>

          <aside className="h-fit rounded-2xl border border-black/10 bg-white p-5 shadow-panel">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Order summary</p>
            {selectedVehicle ? <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm font-black text-ink">Vehicle: {selectedVehicle}</p> : null}
            <div className="mt-4 space-y-3">
              {lineItems.map((item) => (
                <div key={item.lineId ?? `${item.sku}-${item.variantId}`} className="border-b border-black/10 pb-3 last:border-b-0">
                  <div className="flex justify-between gap-3 text-sm font-black text-ink">
                    <span>{item.name}</span>
                    <span>{formatMoney(item.price * item.qty)}</span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-steel">
                    {item.qty} x {item.sku}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-2 text-sm font-bold text-steel">
              <SummaryRow label="Subtotal" value={formatMoney(totals.subtotal)} />
              {pricing.bundleDiscount > 0 ? <SummaryRow label={pricing.bundleLabel || "Bundle discount"} value={`-${formatMoney(pricing.bundleDiscount)}`} highlight /> : null}
              {welcomeRewardDiscount > 0 ? <SummaryRow label="Welcome Reward" value={`-${formatMoney(welcomeRewardDiscount)}`} highlight /> : null}
              {couponDiscount > 0 ? <SummaryRow label="Coupon" value={`-${formatMoney(couponDiscount)}`} highlight /> : null}
              <SummaryRow label="Shipping" value="FREE" highlight />
              <SummaryRow label="GST inc." value={formatMoney(totals.gstIncluded)} />
              <SummaryRow label="Grand total" value={`NZD ${formatMoney(totals.grandTotal)}`} strong />
            </div>
            <button
              type="button"
              onClick={continueToPayment}
              disabled={submitting}
              className="mt-6 inline-flex h-12 w-full items-center justify-center rounded bg-signal px-5 font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Opening secure payment
                </>
              ) : (
                "Continue to secure payment"
              )}
            </button>
            <div className="mt-4 flex items-start gap-2 text-xs font-bold leading-5 text-steel">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p>Address is checked before payment and saved with your order snapshot.</p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function setAddressField<K extends keyof CheckoutShippingAddress>(
  key: K,
  value: CheckoutShippingAddress[K],
  setAddress: Dispatch<SetStateAction<CheckoutShippingAddress>>
) {
  setAddress((current) => ({ ...current, [key]: value }));
}

function normalizeAddress(address: CheckoutShippingAddress): CheckoutShippingAddress {
  return {
    recipientName: address.recipientName.trim(),
    phone: address.phone.trim(),
    line1: address.line1.trim(),
    line2: address.line2?.trim() || undefined,
    suburb: address.suburb?.trim() || undefined,
    city: address.city.trim(),
    region: address.region?.trim() || undefined,
    postcode: address.postcode.trim(),
    country: "NZ",
    source: address.source ?? "manual",
    formatted: address.formatted?.trim() || undefined,
    placeId: address.placeId?.trim() || undefined
  };
}

function getFormValidationError(email: string, address: CheckoutShippingAddress) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Please enter a valid email address.";
  if (address.recipientName.trim().length < 2) return "Please enter the recipient name.";
  if (address.phone.trim().length < 7) return "Please enter a valid phone number.";
  if (address.line1.trim().length < 3) return "Please enter the delivery address line 1.";
  if (address.city.trim().length < 2) return "Please enter the city or town.";
  if (address.postcode.trim().length < 3) return "Please enter the postcode.";
  if (address.country !== "NZ") return "Delivery address must be in New Zealand.";
  return "";
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="text-xs font-black uppercase tracking-[0.14em] text-steel">
        {label}
        {required ? <span className="text-signal"> *</span> : null}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        className="mt-2 h-12 w-full rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-ink outline-none focus:border-ink"
      />
    </div>
  );
}

function SummaryRow({ label, value, highlight = false, strong = false }: { label: string; value: string; highlight?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${highlight ? "text-signal" : ""} ${strong ? "border-t border-black/10 pt-3 text-lg font-black text-ink" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function getSelectedVehicle(items: ReturnType<typeof useCart>["items"]) {
  for (const item of items) {
    const vehicle = item.attributes.vehicle;
    if (typeof vehicle === "string" && vehicle.trim()) return vehicle;
  }

  const make = items.find((item) => typeof item.attributes.vehicle_make === "string")?.attributes.vehicle_make;
  const model = items.find((item) => typeof item.attributes.vehicle_model === "string")?.attributes.vehicle_model;
  const year = items.find((item) => typeof item.attributes.vehicle_year !== "undefined")?.attributes.vehicle_year;
  const vehicle = [make, model, year].filter(Boolean).join(" ");
  return vehicle || "";
}

async function readCheckoutResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as { url?: string; error?: string };
  }

  return {
    error: response.ok ? "Checkout could not be started." : "Checkout is temporarily unavailable. Please try again."
  };
}
