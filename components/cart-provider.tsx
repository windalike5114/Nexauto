"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CartItem } from "@/lib/types";

type CartContextValue = {
  items: CartItem[];
  count: number;
  subtotal: number;
  addItem: (item: CartItem) => void;
  updateQty: (sku: string, qty: number) => void;
  removeItem: (sku: string) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const storageKey = "nexauto-cart";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      setItems(JSON.parse(saved) as CartItem[]);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items]);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);

    return {
      items,
      count,
      subtotal,
      addItem: (item) => {
        setItems((current) => {
          const existing = current.find((entry) => entry.sku === item.sku);
          if (!existing) return [...current, item];
          return current.map((entry) => (entry.sku === item.sku ? { ...entry, qty: entry.qty + item.qty } : entry));
        });
      },
      updateQty: (sku, qty) => {
        setItems((current) =>
          current
            .map((item) => (item.sku === sku ? { ...item, qty: Math.max(1, qty) } : item))
            .filter((item) => item.qty > 0)
        );
      },
      removeItem: (sku) => {
        setItems((current) => current.filter((item) => item.sku !== sku));
      },
      clearCart: () => setItems([])
    };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside CartProvider");
  }
  return context;
}
