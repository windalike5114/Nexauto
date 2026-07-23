"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Gift, X } from "lucide-react";
import { useCart } from "@/components/cart-provider";

const dismissedKey = "nexauto-welcome-reward-dismissed";
const shownKey = "nexauto-welcome-reward-shown";
const autoMinimizeMs = 12000;

type WidgetState = "hidden" | "card" | "tab";

export function WelcomeRewardWidget() {
  const { welcomeRewardStatus, welcomeRewardDiscount, openDrawer, count, isDrawerOpen } = useCart();
  const pathname = usePathname();
  const [state, setState] = useState<WidgetState>("tab");
  const [confirmation, setConfirmation] = useState(false);

  useEffect(() => {
    if (welcomeRewardStatus === "used" || welcomeRewardStatus === "applied") {
      setState("hidden");
      return;
    }

    const dismissed = window.sessionStorage.getItem(dismissedKey) === "true";
    const alreadyShown = window.sessionStorage.getItem(shownKey) === "true";

    if (dismissed) {
      setState("tab");
      return;
    }

    if (alreadyShown) {
      setState("tab");
      return;
    }

    setState("tab");

    const show = () => {
      window.sessionStorage.setItem(shownKey, "true");
      trackRewardEvent("welcome_reward_displayed");
      setState("card");
    };
    const timer = window.setTimeout(show, 8000);

    function onScroll() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      if (window.scrollY / scrollable >= 0.25) {
        window.clearTimeout(timer);
        window.removeEventListener("scroll", onScroll);
        show();
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [welcomeRewardStatus]);

  useEffect(() => {
    if (state !== "card") return;

    const timer = window.setTimeout(() => {
      setState("tab");
    }, autoMinimizeMs);

    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    function onReady() {
      setConfirmation(true);
      window.setTimeout(() => setConfirmation(false), 6500);
    }

    window.addEventListener("nexauto:welcome-reward-ready", onReady);
    return () => window.removeEventListener("nexauto:welcome-reward-ready", onReady);
  }, []);

  const shouldHideOnPage = pathname.startsWith("/checkout") || pathname.startsWith("/admin");

  if (confirmation && !shouldHideOnPage) {
    return (
      <div className="fixed bottom-5 left-5 z-40 w-[min(340px,calc(100vw-32px))] rounded-2xl border border-black/10 bg-white p-4 shadow-2xl">
        <p className="text-sm font-black text-ink">Your NZ$10 Welcome Reward is ready.</p>
        <button type="button" onClick={openDrawer} className="mt-3 h-10 rounded bg-ink px-4 text-sm font-black text-white">
          View Reward
        </button>
      </div>
    );
  }

  if (state === "hidden" || shouldHideOnPage || welcomeRewardStatus === "used" || welcomeRewardStatus === "applied") return null;

  if (state === "tab") {
    return (
      <button
        type="button"
        onClick={() => {
          trackRewardEvent("welcome_reward_reopened");
          setState("card");
        }}
        className={`fixed bottom-5 left-5 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-black text-white shadow-xl transition hover:-translate-y-0.5 motion-reduce:transition-none max-sm:bottom-4 max-sm:left-4 ${isDrawerOpen ? "z-[60]" : "z-40"}`}
        aria-label="Open NZ$10 Welcome Reward"
      >
        <Gift className="h-4 w-4 text-signal" />
        NZ$10 Reward
      </button>
    );
  }

  const signedInReward = welcomeRewardStatus === "available";

  return (
    <aside
      className={`fixed bottom-5 left-5 w-[min(340px,calc(100vw-32px))] rounded-2xl border border-black/10 bg-white p-4 text-ink shadow-2xl max-sm:bottom-4 max-sm:left-4 ${isDrawerOpen ? "z-[60]" : "z-40"}`}
      aria-label="NZ$10 Welcome Reward"
    >
      <button
        type="button"
        onClick={() => {
          window.sessionStorage.setItem(dismissedKey, "true");
          trackRewardEvent("welcome_reward_closed");
          setState("tab");
        }}
        className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded border border-black/10 text-steel hover:text-ink"
        aria-label="Close welcome reward"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-3 pr-8">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-signal text-white">
          <Gift className="h-5 w-5" />
        </span>
        <div>
          <p className="text-lg font-black">{signedInReward ? "NZ$10 Welcome Reward" : "NZ$10 Welcome Reward"}</p>
          <p className="mt-1 text-sm font-bold leading-6 text-steel">
            {signedInReward ? "Ready to use in your cart." : "Create an account and receive NZ$10 off your first order."}
          </p>
        </div>
      </div>
      {signedInReward ? (
        <button
          type="button"
          onClick={() => {
            trackRewardEvent("welcome_reward_view_clicked");
            openDrawer();
          }}
          className="mt-4 h-11 w-full rounded bg-ink px-4 text-sm font-black text-white hover:bg-black"
        >
          {count > 0 ? `View Reward ${welcomeRewardDiscount ? `-${welcomeRewardDiscount}` : ""}` : "View Reward"}
        </button>
      ) : (
        <Link
          href="/account?mode=sign-up"
          onClick={() => trackRewardEvent("welcome_reward_create_account_clicked")}
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded bg-signal px-4 text-sm font-black text-white hover:bg-red-700"
        >
          Create Account
        </Link>
      )}
    </aside>
  );
}

function trackRewardEvent(eventName: string) {
  window.dispatchEvent(new CustomEvent("nexauto:analytics", { detail: { event: eventName } }));
  const dataLayer = (window as unknown as { dataLayer?: Array<Record<string, string>> }).dataLayer;
  dataLayer?.push({ event: eventName });
}
