import { AccountAuth } from "@/components/account-auth";

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Customer account</p>
        <h1 className="mt-3 text-4xl font-black">My Account</h1>
        <p className="mt-4 leading-7 text-steel">
          Manage orders, saved vehicles, shipping addresses, and account settings in one place.
        </p>
      </div>
      <AccountAuth />
    </main>
  );
}
