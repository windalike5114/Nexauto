import { LogOut, Mail } from "lucide-react";
import { AccountNavigation } from "@/components/account/account-navigation";
import type { AccountResponse, AccountSectionId } from "@/components/account/account-types";

export function AccountShell({
  account,
  activeSection,
  setActiveSection,
  loading,
  message,
  signOut,
  children
}: {
  account: AccountResponse;
  activeSection: AccountSectionId;
  setActiveSection: (section: AccountSectionId) => void;
  loading: boolean;
  message: string;
  signOut: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl">
      <section className="rounded-lg border border-black/10 bg-white p-5 shadow-panel sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-ink text-xl font-black text-white">
              {(account.profile.name ?? account.profile.email).slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">My Account</p>
              <h2 className="mt-1 text-3xl font-black">{account.profile.name || "NexAuto Customer"}</h2>
              <p className="mt-1 flex items-center gap-2 text-sm font-bold text-steel">
                <Mail className="h-4 w-4" />
                {account.profile.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded border border-black/10 px-4 text-sm font-black text-ink hover:border-ink disabled:text-steel"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>

        <AccountNavigation activeSection={activeSection} setActiveSection={setActiveSection} />
      </section>

      {message ? <div className="mt-5 rounded-lg border border-black/10 bg-white p-4 text-sm font-bold text-steel shadow-sm">{message}</div> : null}

      {children}
    </div>
  );
}
