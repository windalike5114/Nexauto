"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, Loader2, UserPlus } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { useCart } from "./cart-provider";

export function CheckoutSuccessActions({
  sessionId,
  customerEmail,
  customerName,
  signedIn
}: {
  sessionId?: string;
  customerEmail: string;
  customerName: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const { clearCart } = useCart();
  const clearedRef = useRef(false);
  const [name, setName] = useState(customerName);
  const [email, setEmail] = useState(customerEmail);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (clearedRef.current) return;
    clearedRef.current = true;
    clearCart();
  }, [clearCart]);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name
        }
      }
    });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    if (data.session) {
      await fetch("/api/account");
      router.push("/account" as never);
      return;
    }

    setMessage("Account created. Check your email to confirm your login, then your previous orders will appear automatically.");
  }

  return (
    <div className="mt-6 space-y-4 text-left">
      <div className="rounded border border-mint/20 bg-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle className="mt-0.5 h-5 w-5 text-mint" />
          <div>
            <p className="font-black text-ink">Payment complete</p>
            <p className="mt-1 text-sm font-bold leading-6 text-steel">
              Your cart has been cleared. The order is saved against the checkout email, so account registration stays optional.
            </p>
            {sessionId ? <p className="mt-2 font-mono text-xs font-bold text-steel">Session: {sessionId}</p> : null}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/account" className="inline-flex h-10 items-center rounded bg-ink px-4 text-sm font-black text-white">
            View account
          </Link>
          <Link href="/" className="inline-flex h-10 items-center rounded border border-black/10 bg-white px-4 text-sm font-black text-ink">
            Wiper finder
          </Link>
        </div>
      </div>

      {!signedIn ? (
        <div className="rounded border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-zinc-100 text-signal">
              <UserPlus className="h-5 w-5" />
            </span>
            <div>
              <p className="font-black text-ink">Create an Account</p>
              <p className="mt-1 text-sm font-bold leading-6 text-steel">
                Optional: create an account to view this order, save vehicles, save addresses, and reorder later. Previous orders with the same email will link automatically.
              </p>
            </div>
          </div>

          <form onSubmit={createAccount} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-2 h-11 w-full rounded border border-black/10 px-3 text-sm font-bold outline-none focus:border-ink"
              />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 h-11 w-full rounded border border-black/10 px-3 text-sm font-bold outline-none focus:border-ink"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Password</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 h-11 w-full rounded border border-black/10 px-3 text-sm font-bold outline-none focus:border-ink"
              />
            </label>
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="inline-flex h-11 items-center justify-center gap-2 rounded bg-signal px-4 text-sm font-black text-white hover:bg-red-700 disabled:bg-zinc-300 sm:col-span-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Create Account
            </button>
          </form>

          {message ? <p className="mt-3 rounded bg-zinc-50 p-3 text-sm font-bold text-steel">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
