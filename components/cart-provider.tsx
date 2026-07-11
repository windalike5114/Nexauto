"use client";

import Image from "next/image";
import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Gift, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { formatAttributeName, formatMoney } from "@/lib/catalog";
import { calculateCartPricing, calculateOrderTotals } from "@/lib/pricing";
import type { CartItem } from "@/lib/types";

type CartContextValue = {
  items: CartItem[];
  count: number;
  productsSubtotal: number;
  bundleDiscount: number;
  subtotal: number;
  couponCode: string;
  couponDiscount: number;
  couponLabel: string;
  couponError: string;
  couponDraft: string;
  validatingCoupon: boolean;
  accountEmail: string;
  welcomeRewardStatus: "guest" | "available" | "applied" | "used";
  welcomeRewardDiscount: number;
  applyWelcomeReward: () => void;
  removeWelcomeReward: () => void;
  setCouponDraft: (value: string) => void;
  applyCoupon: () => Promise<void>;
  clearCoupon: () => void;
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  addItem: (item: CartItem) => void;
  updateQty: (lineId: string, qty: number) => void;
  removeItem: (lineId: string) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const storageKey = "nexauto-cart";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [recentlyAdded, setRecentlyAdded] = useState<CartItem | null>(null);
  const [couponDraft, setCouponDraft] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponLabel, setCouponLabel] = useState("");
  const [couponError, setCouponError] = useState("");
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [welcomeRewardStatus, setWelcomeRewardStatus] = useState<"guest" | "available" | "applied" | "used">("guest");
  const welcomeRewardDiscount = welcomeRewardStatus === "applied" ? 10 : 0;

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      setItems((JSON.parse(saved) as CartItem[]).map(normalizeCartItem));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    let active = true;

    fetch("/api/account")
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setAccountEmail("");
          setWelcomeRewardStatus("guest");
          return;
        }

        const data = (await response.json()) as {
          profile?: { email?: string };
          rewards?: { welcome?: { status?: "available" | "used" } };
        };
        setAccountEmail(data.profile?.email ?? "");
        setWelcomeRewardStatus(data.rewards?.welcome?.status === "available" ? "available" : "used");
      })
      .catch(() => {
        if (!active) return;
        setAccountEmail("");
        setWelcomeRewardStatus("guest");
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((sum, item) => sum + item.qty, 0);
    const pricing = calculateCartPricing(items);

    return {
      items,
      count,
      productsSubtotal: pricing.productsSubtotal,
      bundleDiscount: pricing.bundleDiscount,
      subtotal: pricing.subtotal,
      couponCode,
      couponDiscount,
      couponLabel,
      couponError,
      couponDraft,
      validatingCoupon,
      accountEmail,
      welcomeRewardStatus,
      welcomeRewardDiscount,
      applyWelcomeReward: () => {
        if (welcomeRewardStatus === "available") {
          window.dispatchEvent(new CustomEvent("nexauto:analytics", { detail: { event: "reward_applied" } }));
          setWelcomeRewardStatus("applied");
        }
      },
      removeWelcomeReward: () => {
        if (welcomeRewardStatus === "applied") setWelcomeRewardStatus("available");
      },
      setCouponDraft,
      applyCoupon: async () => {
        const nextCoupon = couponDraft.trim();
        setCouponError("");

        if (!nextCoupon) {
          setCouponCode("");
          setCouponDiscount(0);
          setCouponLabel("");
          return;
        }

        setValidatingCoupon(true);

        try {
          const response = await fetch("/api/coupons/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: nextCoupon, amount: pricing.subtotal })
          });
          const data = (await response.json()) as { code?: string; discount?: number; label?: string; error?: string };

          if (!response.ok) {
            throw new Error(data.error ?? "Coupon code is not valid.");
          }

          setCouponCode(data.code ?? nextCoupon);
          setCouponDiscount(Number(data.discount ?? 0));
          setCouponLabel(data.label ?? "Coupon applied");
        } catch (error) {
          setCouponCode("");
          setCouponDiscount(0);
          setCouponLabel("");
          setCouponError(error instanceof Error ? error.message : "Coupon code is not valid.");
        } finally {
          setValidatingCoupon(false);
        }
      },
      clearCoupon: () => {
        setCouponCode("");
        setCouponDiscount(0);
        setCouponLabel("");
        setCouponError("");
        setCouponDraft("");
      },
      isDrawerOpen,
      openDrawer: () => setIsDrawerOpen(true),
      closeDrawer: () => setIsDrawerOpen(false),
      addItem: (item) => {
        const normalizedItem = normalizeCartItem(item);
        setRecentlyAdded(normalizedItem);
        setIsDrawerOpen(true);
        setItems((current) => {
          const existing = current.find((entry) => getLineId(entry) === normalizedItem.lineId);
          if (!existing) return [...current, normalizedItem];
          return current.map((entry) =>
            getLineId(entry) === normalizedItem.lineId ? { ...entry, qty: entry.qty + normalizedItem.qty } : entry
          );
        });
      },
      updateQty: (lineId, qty) => {
        setItems((current) =>
          current
            .map((item) => (getLineId(item) === lineId ? { ...item, qty: Math.max(1, qty) } : item))
            .filter((item) => item.qty > 0)
        );
      },
      removeItem: (lineId) => {
        setItems((current) => current.filter((item) => getLineId(item) !== lineId));
      },
      clearCart: () => setItems([])
    };
  }, [accountEmail, couponCode, couponDiscount, couponDraft, couponError, couponLabel, isDrawerOpen, items, validatingCoupon, welcomeRewardDiscount, welcomeRewardStatus]);

  return (
    <CartContext.Provider value={value}>
      {children}
      <CartDrawer recentlyAdded={recentlyAdded} />
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside CartProvider");
  }
  return context;
}

function CartDrawer({ recentlyAdded }: { recentlyAdded: CartItem | null }) {
  const {
    items,
    isDrawerOpen,
    closeDrawer,
    updateQty,
    removeItem,
    couponCode,
    couponDiscount,
    couponLabel,
    couponError,
    couponDraft,
    validatingCoupon,
    welcomeRewardStatus,
    welcomeRewardDiscount,
    applyWelcomeReward,
    removeWelcomeReward,
    setCouponDraft,
    applyCoupon,
    clearCoupon
  } = useCart();
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const pricing = calculateCartPricing(items);
  const totals = calculateOrderTotals(pricing, couponDiscount + welcomeRewardDiscount);

  async function checkout() {
    if (!items.length || checkingOut) return;

    if (couponDraft.trim() && !couponCode) {
      await applyCoupon();
      return;
    }

    setCheckingOut(true);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          couponCode: couponCode || undefined,
          welcomeRewardApplied: welcomeRewardStatus === "applied"
        })
      });
      const data = (await response.json()) as { url?: string; error?: string };

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      alert(data.error ?? "Checkout is not configured yet.");
    } finally {
      setCheckingOut(false);
    }
  }

  useEffect(() => {
    if (!isDrawerOpen) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus();
    };
  }, [closeDrawer, isDrawerOpen]);

  return (
    <div className={`fixed inset-0 z-50 ${isDrawerOpen ? "" : "pointer-events-none"}`} aria-hidden={!isDrawerOpen}>
      <button
        type="button"
        className={`absolute inset-0 bg-black/45 transition-opacity motion-reduce:transition-none ${isDrawerOpen ? "opacity-100" : "opacity-0"}`}
        onClick={closeDrawer}
        aria-label="Close cart drawer overlay"
      />
      <aside
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
        className={`absolute right-0 top-0 flex h-full w-[min(440px,100vw)] max-w-full flex-col bg-white shadow-2xl outline-none transition-transform duration-200 motion-reduce:transition-none ${
          isDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">Your Cart</p>
            <h2 id="cart-drawer-title" className="text-2xl font-black text-ink">
              {items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : "Cart is empty"}
            </h2>
          </div>
          <button type="button" onClick={closeDrawer} className="grid h-10 w-10 place-items-center rounded border border-black/10 text-steel hover:text-ink" aria-label="Close cart drawer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {recentlyAdded && isDrawerOpen ? (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Recently added: {recentlyAdded.name}</span>
            </div>
          ) : null}

          {pricing.bundleProgressMessage ? (
            <div className="mb-4 rounded-lg border border-signal/20 bg-red-50 p-3 text-sm font-black text-signal">
              {pricing.bundleProgressMessage}
            </div>
          ) : null}

          {items.length ? (
            <div className="space-y-3">
              {items.map((item) => {
                const lineId = getLineId(item);
                return (
                  <article key={lineId} className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
                    <div className="flex gap-3">
                      <CartItemImage item={item} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black leading-5 text-ink">{item.name}</p>
                        <p className="mt-1 text-xs font-bold text-steel">{formatBladeSummary(item)}</p>
                        {getVehicleLabel(item) ? <p className="mt-2 text-xs font-bold text-steel">For: {getVehicleLabel(item)}</p> : null}
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <QuantityControl
                            qty={item.qty}
                            onDecrease={() => updateQty(lineId, item.qty - 1)}
                            onIncrease={() => updateQty(lineId, item.qty + 1)}
                            onChange={(qty) => updateQty(lineId, qty)}
                          />
                          <button type="button" onClick={() => removeItem(lineId)} className="text-xs font-black text-steel hover:text-signal">
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-between border-t border-black/10 pt-3 text-sm font-black">
                      <span>{formatMoney(item.price)} each</span>
                      <span>{formatMoney(item.price * item.qty)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-black/10 bg-zinc-50 p-6 text-center">
              <ShoppingBag className="mx-auto h-8 w-8 text-steel" />
              <p className="mt-3 font-bold text-steel">Your cart is empty.</p>
            </div>
          )}

          <section className="mt-4 rounded-lg border border-black/10 bg-[#F8FAFC] p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">Wiper fitment</p>
            <h3 className="mt-1 text-lg font-black text-ink">Find wipers for another vehicle</h3>
            <div className="mt-3">
              <WiperFitmentFinder
                compact
                directToProduct
                title="Find another front pair"
                description="Select another vehicle and add its matched wipers without losing this cart."
                directButtonLabel="Find Wipers"
              />
            </div>
          </section>
        </div>

        <div className="border-t border-black/10 p-5">
          <CouponBox
            couponCode={couponCode}
            couponDiscount={couponDiscount}
            couponLabel={couponLabel}
            couponError={couponError}
            couponDraft={couponDraft}
            validatingCoupon={validatingCoupon}
            setCouponDraft={setCouponDraft}
            applyCoupon={applyCoupon}
            clearCoupon={clearCoupon}
          />
          <WelcomeRewardBox
            status={welcomeRewardStatus}
            discount={welcomeRewardDiscount}
            onApply={applyWelcomeReward}
            onRemove={removeWelcomeReward}
          />
          <OrderSummaryRows totals={totals} pricing={pricing} welcomeRewardDiscount={welcomeRewardDiscount} couponDiscount={couponDiscount} />
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={closeDrawer} className="h-11 rounded border border-black/10 text-sm font-black text-ink hover:border-ink">
              Continue Shopping
            </button>
            <Link href="/cart" onClick={closeDrawer} className="inline-flex h-11 items-center justify-center rounded border border-black/10 text-sm font-black text-ink hover:border-ink">
              View Full Cart
            </Link>
            <button
              type="button"
              disabled={!items.length || checkingOut}
              onClick={checkout}
              className="h-12 rounded bg-signal px-5 font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {checkingOut ? "Opening checkout..." : "Checkout"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function QuantityControl({ qty, onDecrease, onIncrease, onChange }: { qty: number; onDecrease: () => void; onIncrease: () => void; onChange: (qty: number) => void }) {
  return (
    <div className="grid h-9 w-28 grid-cols-3 rounded border border-black/10">
      <button type="button" onClick={onDecrease} aria-label="Decrease quantity">
        <Minus className="mx-auto h-3.5 w-3.5" />
      </button>
      <input
        aria-label="Quantity"
        type="number"
        min={1}
        value={qty}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 border-x border-black/10 text-center text-sm font-black outline-none"
      />
      <button type="button" onClick={onIncrease} aria-label="Increase quantity">
        <Plus className="mx-auto h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function CartItemImage({ item }: { item: CartItem }) {
  if (!item.imageUrl) {
    return <div className="grid h-20 w-20 shrink-0 place-items-center rounded bg-zinc-100 text-xs font-black text-steel">NexAuto</div>;
  }

  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded bg-zinc-50">
      <Image src={item.imageUrl} alt="" fill className="object-contain p-2" sizes="80px" />
    </div>
  );
}

function SummaryRow({ label, value, highlight = false, strong = false }: { label: string; value: string; highlight?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${highlight ? "text-signal" : ""} ${strong ? "pt-2 text-lg font-black text-ink" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function CouponBox({
  couponCode,
  couponDiscount,
  couponLabel,
  couponError,
  couponDraft,
  validatingCoupon,
  setCouponDraft,
  applyCoupon,
  clearCoupon
}: {
  couponCode: string;
  couponDiscount: number;
  couponLabel: string;
  couponError: string;
  couponDraft: string;
  validatingCoupon: boolean;
  setCouponDraft: (value: string) => void;
  applyCoupon: () => Promise<void>;
  clearCoupon: () => void;
}) {
  return (
    <div className="mb-4 rounded-lg border border-black/10 bg-zinc-50 p-3">
      <label htmlFor="drawer-coupon" className="text-xs font-black uppercase tracking-[0.14em] text-steel">
        Coupon code
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="drawer-coupon"
          value={couponDraft}
          onChange={(event) => setCouponDraft(event.target.value)}
          placeholder="Enter code"
          className="h-10 min-w-0 flex-1 rounded border border-black/10 bg-white px-3 text-sm font-bold text-ink outline-none focus:border-ink"
        />
        <button
          type="button"
          onClick={applyCoupon}
          disabled={validatingCoupon}
          className="h-10 rounded bg-ink px-3 text-xs font-black text-white hover:bg-black disabled:bg-zinc-300"
        >
          {validatingCoupon ? "Checking" : "Apply"}
        </button>
      </div>
      {couponCode ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
          <span>
            Applied: {couponCode} ({couponLabel}, {formatMoney(couponDiscount)})
          </span>
          <button type="button" onClick={clearCoupon} className="font-black uppercase tracking-[0.12em] text-emerald-900 hover:text-ink">
            Remove
          </button>
        </div>
      ) : null}
      {couponError ? <p className="mt-2 text-xs font-bold text-signal">{couponError}</p> : null}
    </div>
  );
}

function WelcomeRewardBox({
  status,
  discount,
  onApply,
  onRemove
}: {
  status: "guest" | "available" | "applied" | "used";
  discount: number;
  onApply: () => void;
  onRemove: () => void;
}) {
  if (status === "guest" || status === "used") return null;

  return (
    <div className="mb-4 rounded-lg border border-red-100 bg-red-50 p-3">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-signal text-white">
          <Gift className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-ink">
            {status === "applied" ? "Welcome Reward Applied" : "Welcome Reward"}
          </p>
          <p className="mt-1 text-xs font-bold leading-5 text-steel">
            {status === "applied" ? `-${formatMoney(discount)} applied to this cart.` : "NZ$10 registration reward available."}
          </p>
          <button
            type="button"
            onClick={status === "applied" ? onRemove : onApply}
            className="mt-2 h-9 rounded bg-ink px-3 text-xs font-black text-white hover:bg-black"
          >
            {status === "applied" ? "Remove" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderSummaryRows({
  totals,
  pricing,
  welcomeRewardDiscount,
  couponDiscount
}: {
  totals: ReturnType<typeof calculateOrderTotals>;
  pricing: ReturnType<typeof calculateCartPricing>;
  welcomeRewardDiscount: number;
  couponDiscount: number;
}) {
  return (
    <div className="space-y-2 text-sm font-bold text-steel">
      <SummaryRow label="Subtotal" value={formatMoney(totals.subtotal)} />
      {pricing.bundleDiscount > 0 ? <SummaryRow label={pricing.bundleLabel || "Bundle discount"} value={`-${formatMoney(pricing.bundleDiscount)}`} highlight /> : null}
      {welcomeRewardDiscount > 0 ? <SummaryRow label="Welcome Reward" value={`-${formatMoney(welcomeRewardDiscount)}`} highlight /> : null}
      {couponDiscount > 0 ? <SummaryRow label="Coupon" value={`-${formatMoney(couponDiscount)}`} highlight /> : null}
      <SummaryRow label="Shipping" value="FREE" highlight />
      <SummaryRow label="GST inc." value={formatMoney(totals.gstIncluded)} />
      <SummaryRow label="Order total" value={formatMoney(totals.orderTotal)} />
      {totals.discount > 0 ? <SummaryRow label="Discount" value={`-${formatMoney(totals.discount)}`} highlight /> : null}
      <SummaryRow label="Grand total" value={`NZD ${formatMoney(totals.grandTotal)}`} strong />
    </div>
  );
}

function normalizeCartItem(item: CartItem): CartItem {
  const normalized = {
    ...item,
    qty: Math.max(1, Math.floor(Number(item.qty) || 1)),
    bundleEligible: item.bundleEligible ?? item.productId === "wiper_set",
    bundleCategory: item.bundleCategory ?? (item.productId === "wiper_set" ? "front-wiper-pair" : undefined)
  };

  return {
    ...normalized,
    lineId: item.lineId ?? buildLineId(normalized)
  };
}

function buildLineId(item: CartItem) {
  return [
    item.productId,
    item.variantId,
    item.sku,
    String(item.attributes.vehicle_application_id ?? ""),
    String(item.attributes.vehicle ?? ""),
    stableAttributeSignature(item.attributes)
  ].join("|");
}

function getLineId(item: CartItem) {
  return item.lineId ?? buildLineId(normalizeCartItem(item));
}

function stableAttributeSignature(attributes: CartItem["attributes"]) {
  return Object.keys(attributes)
    .sort()
    .map((key) => `${key}:${String(attributes[key])}`)
    .join(";");
}

function formatBladeSummary(item: CartItem) {
  const driver = item.attributes.driver_length;
  const passenger = item.attributes.passenger_length;
  const rear = item.attributes.rear_length;

  if (driver && passenger) return `${driver} Driver + ${passenger} Passenger`;
  if (rear) return `${rear} Rear`;

  const visible = Object.entries(item.attributes)
    .filter(([key]) => isCustomerVisibleAttribute(key))
    .map(([key, value]) => `${formatAttributeName(key)}: ${String(value)}`);

  return visible.join(" / ") || item.sku;
}

function getVehicleLabel(item: CartItem) {
  const vehicle = item.attributes.vehicle;
  if (typeof vehicle === "string" && vehicle.trim()) return vehicle;

  return [item.attributes.vehicle_year, item.attributes.vehicle_make, item.attributes.vehicle_model].filter(Boolean).join(" ");
}

function isCustomerVisibleAttribute(key: string) {
  return !["vehicle", "vehicle_application_id", "vehicle_make", "vehicle_model", "vehicle_year"].includes(key);
}
