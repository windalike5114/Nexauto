"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { useCart } from "./cart-provider";

export function CheckoutSuccessActions({ sessionId }: { sessionId?: string }) {
  const { clearCart } = useCart();
  const clearedRef = useRef(false);

  useEffect(() => {
    if (clearedRef.current) return;
    clearedRef.current = true;
    clearCart();
  }, [clearCart]);

  return (
    <div className="mt-6 rounded border border-mint/20 bg-emerald-50 p-4 text-left">
      <div className="flex items-start gap-3">
        <CheckCircle className="mt-0.5 h-5 w-5 text-mint" />
        <div>
          <p className="font-black text-ink">Payment complete</p>
          <p className="mt-1 text-sm font-bold leading-6 text-steel">
            Your cart has been cleared. Stripe will notify the store automatically and create the order record.
          </p>
          {sessionId ? <p className="mt-2 font-mono text-xs font-bold text-steel">Session: {sessionId}</p> : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/account" className="inline-flex h-10 items-center rounded bg-ink px-4 text-sm font-black text-white">
          View account
        </Link>
        <Link href="/shop?category=wiper" className="inline-flex h-10 items-center rounded border border-black/10 bg-white px-4 text-sm font-black text-ink">
          Wiper finder
        </Link>
      </div>
    </div>
  );
}
