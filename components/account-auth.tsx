"use client";

import { FormEvent, useEffect, useState } from "react";
import { CarFront, Loader2, LogIn, LogOut, UserPlus } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

type Mode = "sign-in" | "sign-up";

type AccountResponse = {
  user: {
    id: string;
    email: string;
  };
  profile: {
    id: string;
    email: string;
    name: string | null;
  };
  vehicles: Array<{
    id: string;
    make: string;
    model: string;
    year: number;
    lastUsedAt: string;
  }>;
};

export function AccountAuth() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    void loadAccount();

    const supabase = createClient();
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(() => {
      void loadAccount();
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadAccount() {
    setCheckingSession(true);

    const response = await fetch("/api/account");
    if (!response.ok) {
      setAccount(null);
      setCheckingSession(false);
      return;
    }

    const data = (await response.json()) as AccountResponse;
    setAccount(data);
    setCheckingSession(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const supabase = createClient();
    const action =
      mode === "sign-in"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error } = await action;

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(mode === "sign-in" ? "Signed in successfully." : "Account created. Check email if confirmation is enabled.");
    await loadAccount();
  }

  async function signOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    setAccount(null);
    setLoading(false);
  }

  if (checkingSession) {
    return (
      <div className="mx-auto grid max-w-md place-items-center rounded-lg border border-black/10 bg-white p-8 shadow-panel">
        <Loader2 className="h-6 w-6 animate-spin text-signal" />
      </div>
    );
  }

  if (account) {
    return (
      <div className="mx-auto grid max-w-4xl gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-lg border border-black/10 bg-white p-6 shadow-panel">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Signed in</p>
          <h2 className="mt-2 text-2xl font-black">{account.profile.email}</h2>
          <p className="mt-3 text-sm font-bold leading-6 text-steel">
            Your vehicle garage is linked to this email. Orders will use the same profile when checkout is connected.
          </p>
          <button
            type="button"
            onClick={signOut}
            disabled={loading}
            className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded border border-black/10 px-4 text-sm font-black text-ink hover:border-ink disabled:text-steel"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </section>

        <section className="rounded-lg border border-black/10 bg-white p-6 shadow-panel">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Garage</p>
              <h2 className="mt-2 text-2xl font-black">Saved vehicles</h2>
            </div>
            <CarFront className="h-6 w-6 text-signal" />
          </div>

          {account.vehicles.length ? (
            <div className="mt-5 grid gap-3">
              {account.vehicles.map((vehicle) => (
                <article key={vehicle.id} className="rounded border border-black/10 bg-zinc-50 p-4">
                  <p className="font-black">
                    {vehicle.make} {vehicle.model} {vehicle.year}
                  </p>
                  <p className="mt-1 text-xs font-bold text-steel">
                    Last used {new Date(vehicle.lastUsedAt).toLocaleDateString("en-NZ")}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded border border-black/10 bg-zinc-50 p-4 text-sm font-bold leading-6 text-steel">
              No saved vehicles yet. Use the wiper finder while signed in, then save the result to your garage.
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border border-black/10 bg-white p-6 shadow-panel">
      <div className="grid grid-cols-2 rounded border border-black/10 bg-zinc-50 p-1">
        <button
          type="button"
          onClick={() => setMode("sign-in")}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded text-sm font-black ${
            mode === "sign-in" ? "bg-ink text-white" : "text-steel"
          }`}
        >
          <LogIn className="h-4 w-4" />
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("sign-up")}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded text-sm font-black ${
            mode === "sign-up" ? "bg-ink text-white" : "text-steel"
          }`}
        >
          <UserPlus className="h-4 w-4" />
          Create
        </button>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="text-sm font-black" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 h-12 w-full rounded border border-black/10 px-3 outline-none focus:border-ink"
          />
        </div>
        <div>
          <label className="text-sm font-black" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 h-12 w-full rounded border border-black/10 px-3 outline-none focus:border-ink"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="h-12 w-full rounded bg-signal px-5 font-black text-white hover:bg-red-700 disabled:bg-zinc-300"
        >
          {loading ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>

      {message ? <p className="mt-4 rounded bg-zinc-50 p-3 text-sm font-bold text-steel">{message}</p> : null}
    </div>
  );
}
