"use client";

import { ShoppingCart } from "lucide-react";
import { useCart } from "./cart-provider";

export function CartLink() {
  const { count, openDrawer } = useCart();

  return (
    <button
      type="button"
      onClick={openDrawer}
      className="inline-flex min-h-10 items-center gap-2 rounded bg-ink px-3 py-2 font-bold text-white hover:bg-black"
      aria-label="Open cart"
    >
      <ShoppingCart aria-hidden className="h-4 w-4" />
      <span>{count}</span>
    </button>
  );
}
