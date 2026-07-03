"use client";

import { FormEvent, useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

type Mode = "sign-in" | "sign-up";

export function AccountAuth() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

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
    setMessage(error ? error.message : mode === "sign-in" ? "Signed in successfully." : "Account created. Check email if confirmation is enabled.");
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
