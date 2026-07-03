import { AccountAuth } from "@/components/account-auth";

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Customer account</p>
        <h1 className="mt-3 text-4xl font-black">Sign in or create an account</h1>
        <p className="mt-4 leading-7 text-steel">
          Save order details and prepare for faster repeat purchases as the catalog expands.
        </p>
      </div>
      <AccountAuth />
    </main>
  );
}
