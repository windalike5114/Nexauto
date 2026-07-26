import Link from "next/link";
import { Star } from "lucide-react";
import type { AccountResponse } from "@/components/account/account-types";
import { Panel } from "@/components/account/account-ui";

export function RewardsSection({ reward }: { reward: AccountResponse["rewards"]["welcome"] }) {
  const available = reward.status === "available";

  return (
    <Panel title="Rewards" icon={<Star className="h-5 w-5" />} className="mt-6">
      <article className={`rounded-lg border p-5 ${available ? "border-red-100 bg-red-50" : "border-black/10 bg-zinc-50"}`}>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-signal">NZ${reward.amount} Welcome Reward</p>
        <h3 className="mt-2 text-2xl font-black text-ink">{available ? "Ready to use in your cart" : "Reward used"}</h3>
        <p className="mt-2 text-sm font-bold leading-6 text-steel">
          {available
            ? "Apply your account welcome reward in the cart before checkout. The discount is validated securely before payment."
            : "This first-order welcome reward has already been used or is no longer available."}
        </p>
        {available ? (
          <Link href="/cart" className="mt-4 inline-flex h-11 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white hover:bg-black">
            View Cart
          </Link>
        ) : null}
      </article>
    </Panel>
  );
}
