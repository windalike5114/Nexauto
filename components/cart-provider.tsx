"use client";

import Image from "next/image";
import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { formatAttributeName, formatMoney } from "@/lib/catalog";
import { calculateCartPricing } from "@/lib/pricing";
import type { CartItem } from "@/lib/types";

type CartContextValue = {
  items: CartItem[];
  count: number;
  productsSubtotal: number;
  bundleDiscount: number;
  subtotal: number;
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

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      setItems((JSON.parse(saved) as CartItem[]).map(normalizeCartItem));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items]);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((sum, item) => sum + item.qty, 0);
    const pricing = calculateCartPricing(items);

    return {
      items,
      count,
      productsSubtotal: pricing.productsSubtotal,
      bundleDiscount: pricing.bundleDiscount,
      subtotal: pricing.subtotal,
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
  }, [isDrawerOpen, items]);

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
  const { items, isDrawerOpen, closeDrawer, updateQty, removeItem, productsSubtotal, bundleDiscount, subtotal } = useCart();
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const pricing = calculateCartPricing(items);

  async function checkout() {
    if (!items.length || checkingOut) return;

    setCheckingOut(true);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items })
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
        </div>

        <div className="border-t border-black/10 p-5">
          <div className="space-y-2 text-sm font-bold text-steel">
            <SummaryRow label="Products subtotal" value={formatMoney(productsSubtotal)} />
            {bundleDiscount > 0 ? <SummaryRow label={pricing.bundleLabel || "Bundle discount"} value={`-${formatMoney(bundleDiscount)}`} highlight /> : null}
            <SummaryRow label="Subtotal" value={formatMoney(subtotal)} strong />
          </div>
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
