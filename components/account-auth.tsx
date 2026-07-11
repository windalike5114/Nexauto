"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CarFront,
  Download,
  Home,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  PackageCheck,
  Plus,
  RotateCcw,
  Settings,
  Star,
  Trash2,
  Truck,
  User,
  UserPlus,
  Wrench
} from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { createClient } from "@/utils/supabase/client";

type Mode = "sign-in" | "sign-up" | "reset-password";

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
    applicationId: string | null;
    make: string;
    model: string;
    year: number;
    lastUsedAt: string;
  }>;
  orders: Array<{
    id: string;
    orderNumber: string;
    orderDate: string;
    status: string;
    vehicle: string | null;
    products: string[];
    total: number;
  }>;
  rewards: {
    welcome: {
      amount: number;
      status: "available" | "used";
    };
  };
};

type Address = {
  id: string;
  label: string;
  name: string;
  line1: string;
  suburb: string;
  city: string;
  postcode: string;
  isDefault: boolean;
};

export function AccountAuth({ initialMode = "sign-in" }: { initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [defaultVehicleId, setDefaultVehicleId] = useState("");
  const [vehicleActionId, setVehicleActionId] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [settingsPassword, setSettingsPassword] = useState("");
  const [newsletter, setNewsletter] = useState(true);

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

  useEffect(() => {
    if (!account) return;

    const defaultKey = `nexauto-default-vehicle-${account.profile.email}`;
    const addressKey = `nexauto-addresses-${account.profile.email}`;
    const newsletterKey = `nexauto-newsletter-${account.profile.email}`;
    const storedDefault = window.localStorage.getItem(defaultKey);
    const storedAddresses = window.localStorage.getItem(addressKey);
    const storedNewsletter = window.localStorage.getItem(newsletterKey);

    setDefaultVehicleId(storedDefault && account.vehicles.some((vehicle) => vehicle.id === storedDefault) ? storedDefault : account.vehicles[0]?.id ?? "");
    setAddresses(storedAddresses ? (JSON.parse(storedAddresses) as Address[]) : []);
    setNewsletter(storedNewsletter ? storedNewsletter === "true" : true);
    setSettingsName(account.profile.name ?? "");
  }, [account]);

  const defaultVehicle = useMemo(
    () => account?.vehicles.find((vehicle) => vehicle.id === defaultVehicleId) ?? account?.vehicles[0] ?? null,
    [account, defaultVehicleId]
  );
  const recentOrders = account?.orders.slice(0, 3) ?? [];

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
      mode === "reset-password"
        ? supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/account` })
        : mode === "sign-in"
          ? supabase.auth.signInWithPassword({ email, password })
          : supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: `${window.location.origin}/account` }
            });
    const { error } = await action;

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(
      mode === "reset-password"
        ? "Password reset email sent. Check your inbox for the secure link."
        : mode === "sign-in"
          ? "Signed in successfully."
          : "Account created. Check email if confirmation is enabled."
    );
    if (mode === "sign-up") {
      window.sessionStorage.setItem("nexauto-welcome-registration-success", "true");
      window.dispatchEvent(new CustomEvent("nexauto:welcome-reward-ready"));
      window.dispatchEvent(new CustomEvent("nexauto:analytics", { detail: { event: "registration_completed" } }));
    }
    await loadAccount();
  }

  async function signOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    setAccount(null);
    setLoading(false);
  }

  function saveDefaultVehicle(vehicleId: string) {
    if (!account) return;
    setDefaultVehicleId(vehicleId);
    window.localStorage.setItem(`nexauto-default-vehicle-${account.profile.email}`, vehicleId);
  }

  async function removeVehicle(vehicleId: string) {
    setVehicleActionId(vehicleId);
    setMessage("");

    try {
      const response = await fetch(`/api/account/vehicles?id=${vehicleId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not remove vehicle.");
      await loadAccount();
      setMessage("Vehicle removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove vehicle.");
    } finally {
      setVehicleActionId("");
    }
  }

  async function findWipers(vehicle: AccountResponse["vehicles"][number]) {
    setVehicleActionId(vehicle.id);
    setMessage("");

    try {
      const makes = await fetchJson<{ makes: Array<{ id: string; name: string }> }>("/api/fitment/wipers/makes");
      const make = makes.makes.find((entry) => sameText(entry.name, vehicle.make));
      if (!make) throw new Error("Could not match vehicle make.");

      const models = await fetchJson<{ models: Array<{ id: string; name: string }> }>(`/api/fitment/wipers/models?makeId=${make.id}`);
      const model = models.models.find((entry) => sameText(entry.name, vehicle.model));
      if (!model) throw new Error("Could not match vehicle model.");

      const data = await fetchJson<{ fitments: FitmentResult[] }>(
        `/api/fitment/wipers/results?makeId=${make.id}&modelId=${model.id}&year=${vehicle.year}`
      );
      const fitment = data.fitments.find((entry) => entry.frontPair);

      if (!fitment?.frontPair) throw new Error("No active wiper kit exists for this vehicle yet.");

      const params = new URLSearchParams({
        vehicle: vehicleLabel(vehicle),
        applicationId: fitment.applicationId,
        make: vehicle.make,
        model: vehicle.model,
        year: String(vehicle.year)
      });
      if (fitment.rearAddon) params.set("rearAddonId", fitment.rearAddon.id);
      router.push(`/wipers/${fitment.frontPair.sku}?${params.toString()}` as never);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not find wipers.");
    } finally {
      setVehicleActionId("");
    }
  }

  function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;

    const formData = new FormData(event.currentTarget);
    const nextAddress: Address = {
      id: crypto.randomUUID(),
      label: String(formData.get("label") ?? "Shipping"),
      name: String(formData.get("name") ?? ""),
      line1: String(formData.get("line1") ?? ""),
      suburb: String(formData.get("suburb") ?? ""),
      city: String(formData.get("city") ?? ""),
      postcode: String(formData.get("postcode") ?? ""),
      isDefault: addresses.length === 0
    };
    const nextAddresses = [...addresses, nextAddress];

    setAddresses(nextAddresses);
    window.localStorage.setItem(`nexauto-addresses-${account.profile.email}`, JSON.stringify(nextAddresses));
    setShowAddressForm(false);
  }

  function removeAddress(addressId: string) {
    if (!account) return;
    const nextAddresses = addresses.filter((address) => address.id !== addressId);
    setAddresses(nextAddresses);
    window.localStorage.setItem(`nexauto-addresses-${account.profile.email}`, JSON.stringify(nextAddresses));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;

    setLoading(true);
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      ...(settingsPassword ? { password: settingsPassword } : {}),
      data: { name: settingsName }
    });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    window.localStorage.setItem(`nexauto-newsletter-${account.profile.email}`, String(newsletter));
    setSettingsPassword("");
    setMessage("Account settings saved.");
    await loadAccount();
  }

  if (checkingSession) {
    return (
      <div className="mx-auto grid max-w-md place-items-center rounded-lg border border-black/10 bg-white p-8 shadow-panel">
        <Loader2 className="h-6 w-6 animate-spin text-signal" />
      </div>
    );
  }

  if (!account) {
    return <AuthCard mode={mode} setMode={setMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} loading={loading} message={message} submit={submit} />;
  }

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

        <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={`inline-flex h-10 shrink-0 items-center rounded px-4 text-sm font-black ${
                activeSection === section.id ? "bg-ink text-white" : "bg-zinc-100 text-steel hover:bg-zinc-200"
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </section>

      {message ? <div className="mt-5 rounded-lg border border-black/10 bg-white p-4 text-sm font-bold text-steel shadow-sm">{message}</div> : null}

      {activeSection === "dashboard" ? (
        <DashboardSection
          orders={account.orders}
          recentOrders={recentOrders}
          vehicles={account.vehicles}
          defaultVehicle={defaultVehicle}
          setActiveSection={setActiveSection}
          onFindWipers={findWipers}
          busyVehicleId={vehicleActionId}
        />
      ) : null}
      {activeSection === "orders" ? <OrdersSection orders={account.orders} /> : null}
      {activeSection === "rewards" ? <RewardsSection reward={account.rewards.welcome} /> : null}
      {activeSection === "vehicles" ? (
        <VehiclesSection
          vehicles={account.vehicles}
          defaultVehicleId={defaultVehicleId}
          busyVehicleId={vehicleActionId}
          setDefaultVehicle={saveDefaultVehicle}
          removeVehicle={removeVehicle}
          findWipers={findWipers}
          refresh={loadAccount}
        />
      ) : null}
      {activeSection === "addresses" ? (
        <AddressesSection
          addresses={addresses}
          showForm={showAddressForm}
          setShowForm={setShowAddressForm}
          saveAddress={saveAddress}
          removeAddress={removeAddress}
        />
      ) : null}
      {activeSection === "settings" ? (
        <SettingsSection
          email={account.profile.email}
          name={settingsName}
          setName={setSettingsName}
          password={settingsPassword}
          setPassword={setSettingsPassword}
          newsletter={newsletter}
          setNewsletter={setNewsletter}
          loading={loading}
          saveSettings={saveSettings}
        />
      ) : null}
    </div>
  );
}

function AuthCard({
  mode,
  setMode,
  email,
  setEmail,
  password,
  setPassword,
  loading,
  message,
  submit
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
  email: string;
  setEmail: (email: string) => void;
  password: string;
  setPassword: (password: string) => void;
  loading: boolean;
  message: string;
  submit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-black/10 bg-white p-6 shadow-panel">
      <div className="grid grid-cols-2 rounded border border-black/10 bg-zinc-50 p-1">
        <AuthModeButton active={mode === "sign-in"} icon={<LogIn className="h-4 w-4" />} label="Sign in" onClick={() => setMode("sign-in")} />
        <AuthModeButton active={mode === "sign-up"} icon={<UserPlus className="h-4 w-4" />} label="Create" onClick={() => setMode("sign-up")} />
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <TextInput id="email" label="Email" type="email" value={email} onChange={setEmail} required />
        {mode !== "reset-password" ? (
          <TextInput id="password" label="Password" type="password" value={password} onChange={setPassword} required minLength={6} />
        ) : null}
        <button type="submit" disabled={loading} className="h-12 w-full rounded bg-signal px-5 font-black text-white hover:bg-red-700 disabled:bg-zinc-300">
          {loading ? "Working..." : mode === "reset-password" ? "Send reset link" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>

      <div className="mt-4 flex justify-center">
        {mode === "reset-password" ? (
          <button type="button" onClick={() => setMode("sign-in")} className="text-sm font-black text-steel hover:text-ink">
            Back to sign in
          </button>
        ) : (
          <button type="button" onClick={() => setMode("reset-password")} className="text-sm font-black text-steel hover:text-ink">
            Forgot password?
          </button>
        )}
      </div>

      {message ? <p className="mt-4 rounded bg-zinc-50 p-3 text-sm font-bold text-steel">{message}</p> : null}
    </div>
  );
}

function DashboardSection({
  orders,
  recentOrders,
  vehicles,
  defaultVehicle,
  setActiveSection,
  onFindWipers,
  busyVehicleId
}: {
  orders: AccountResponse["orders"];
  recentOrders: AccountResponse["orders"];
  vehicles: AccountResponse["vehicles"];
  defaultVehicle: AccountResponse["vehicles"][number] | null;
  setActiveSection: (section: string) => void;
  onFindWipers: (vehicle: AccountResponse["vehicles"][number]) => void;
  busyVehicleId: string;
}) {
  return (
    <section className="mt-6 grid gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric icon={<PackageCheck className="h-5 w-5" />} label="Recent Orders" value={String(orders.length)} />
        <Metric icon={<CarFront className="h-5 w-5" />} label="Saved Vehicles" value={String(vehicles.length)} />
        <Metric icon={<Star className="h-5 w-5" />} label="Default Vehicle" value={defaultVehicle ? vehicleLabel(defaultVehicle) : "Not set"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Recent Orders" icon={<PackageCheck className="h-5 w-5" />}>
          {recentOrders.length ? (
            <div className="grid gap-3">
              {recentOrders.map((order) => (
                <OrderSummary key={order.id} order={order} />
              ))}
            </div>
          ) : (
            <EmptyState text="No orders yet." />
          )}
        </Panel>

        <Panel title="Quick Actions" icon={<Wrench className="h-5 w-5" />}>
          <div className="grid gap-3">
            <button
              type="button"
              disabled={!defaultVehicle || busyVehicleId === defaultVehicle?.id}
              onClick={() => defaultVehicle && onFindWipers(defaultVehicle)}
              className="h-11 rounded bg-signal px-4 text-sm font-black text-white hover:bg-red-700 disabled:bg-zinc-300"
            >
              Find Wipers
            </button>
            <button type="button" onClick={() => setActiveSection("orders")} className="h-11 rounded border border-black/10 px-4 text-sm font-black text-ink hover:border-ink">
              Track Order
            </button>
            <button type="button" onClick={() => setActiveSection("orders")} className="h-11 rounded border border-black/10 px-4 text-sm font-black text-ink hover:border-ink">
              Reorder Previous Purchase
            </button>
            <Link href="/contact" className="inline-flex h-11 items-center justify-center rounded border border-black/10 px-4 text-sm font-black text-ink hover:border-ink">
              Contact Support
            </Link>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function OrdersSection({ orders }: { orders: AccountResponse["orders"] }) {
  return (
    <Panel title="Orders" icon={<PackageCheck className="h-5 w-5" />} className="mt-6">
      {orders.length ? (
        <div className="grid gap-4">
          {orders.map((order) => (
            <article key={order.id} className="rounded-lg border border-black/10 bg-zinc-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-mono text-xs font-black text-steel">Order Number {order.orderNumber}</p>
                  <h3 className="mt-1 text-xl font-black">{formatMoney(order.total)}</h3>
                  <p className="mt-1 text-sm font-bold text-steel">Order Date {new Date(order.orderDate).toLocaleDateString("en-NZ")}</p>
                </div>
                <span className="inline-flex h-8 items-center rounded bg-white px-3 text-xs font-black uppercase tracking-[0.12em] text-steel">{order.status}</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <InfoTile label="Vehicle" value={order.vehicle ?? "Not attached"} />
                <InfoTile label="Products" value={order.products.join(", ") || "No products"} />
                <InfoTile label="Total" value={formatMoney(order.total)} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <OrderButton icon={<PackageCheck className="h-4 w-4" />} label="View Details" />
                <OrderButton icon={<Truck className="h-4 w-4" />} label="Track Order" />
                <OrderButton icon={<Download className="h-4 w-4" />} label="Download Invoice" />
                <OrderButton icon={<RotateCcw className="h-4 w-4" />} label="Reorder" />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No orders yet." />
      )}
    </Panel>
  );
}

function RewardsSection({ reward }: { reward: AccountResponse["rewards"]["welcome"] }) {
  const available = reward.status === "available";

  return (
    <Panel title="Rewards" icon={<Star className="h-5 w-5" />} className="mt-6">
      <article className={`rounded-lg border p-5 ${available ? "border-red-100 bg-red-50" : "border-black/10 bg-zinc-50"}`}>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-signal">NZ${reward.amount} Welcome Reward</p>
        <h3 className="mt-2 text-2xl font-black text-ink">
          {available ? "Ready to use in your cart" : "Reward used"}
        </h3>
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

function VehiclesSection({
  vehicles,
  defaultVehicleId,
  busyVehicleId,
  setDefaultVehicle,
  removeVehicle,
  findWipers,
  refresh
}: {
  vehicles: AccountResponse["vehicles"];
  defaultVehicleId: string;
  busyVehicleId: string;
  setDefaultVehicle: (vehicleId: string) => void;
  removeVehicle: (vehicleId: string) => void;
  findWipers: (vehicle: AccountResponse["vehicles"][number]) => void;
  refresh: () => void;
}) {
  return (
    <section className="mt-6 grid gap-5">
      <Panel title="Saved Vehicles" icon={<CarFront className="h-5 w-5" />}>
        {vehicles.length ? (
          <div className="grid gap-4">
            {vehicles.map((vehicle) => (
              <article key={vehicle.id} className="rounded-lg border border-black/10 bg-zinc-50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-xl font-black">{vehicleLabel(vehicle)}</h3>
                    {vehicle.id === defaultVehicleId ? <p className="mt-1 text-sm font-black text-signal">Default Vehicle</p> : null}
                    <p className="mt-1 text-xs font-bold text-steel">Last used {new Date(vehicle.lastUsedAt).toLocaleDateString("en-NZ")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => findWipers(vehicle)} disabled={busyVehicleId === vehicle.id} className="h-10 rounded bg-signal px-3 text-sm font-black text-white hover:bg-red-700 disabled:bg-zinc-300">
                      {busyVehicleId === vehicle.id ? "Finding..." : "Find Wipers"}
                    </button>
                    <button type="button" onClick={() => setDefaultVehicle(vehicle.id)} className="h-10 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink">
                      Set as Default
                    </button>
                    <button type="button" className="h-10 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink">
                      Edit
                    </button>
                    <button type="button" onClick={() => removeVehicle(vehicle.id)} disabled={busyVehicleId === vehicle.id} className="inline-flex h-10 items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink disabled:text-steel">
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState text="No saved vehicles yet." />
        )}
      </Panel>

      <Panel title="Add Another Vehicle" icon={<Plus className="h-5 w-5" />}>
        <WiperFitmentFinder compact onVehicleSaved={refresh} />
      </Panel>
    </section>
  );
}

function AddressesSection({
  addresses,
  showForm,
  setShowForm,
  saveAddress,
  removeAddress
}: {
  addresses: Address[];
  showForm: boolean;
  setShowForm: (value: boolean) => void;
  saveAddress: (event: FormEvent<HTMLFormElement>) => void;
  removeAddress: (addressId: string) => void;
}) {
  return (
    <Panel title="Addresses" icon={<MapPin className="h-5 w-5" />} className="mt-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-ink">Default Shipping Address</p>
          <p className="mt-1 text-sm font-bold text-steel">{addresses.find((address) => address.isDefault)?.line1 ?? "No default address"}</p>
        </div>
        <button type="button" onClick={() => setShowForm(!showForm)} className="inline-flex h-11 items-center justify-center gap-2 rounded bg-ink px-4 text-sm font-black text-white">
          <Plus className="h-4 w-4" />
          Add Address
        </button>
      </div>

      {showForm ? (
        <form onSubmit={saveAddress} className="mb-5 grid gap-3 rounded-lg border border-black/10 bg-zinc-50 p-4 md:grid-cols-2">
          <Field name="label" label="Address label" defaultValue="Shipping" />
          <Field name="name" label="Name" required />
          <Field name="line1" label="Address line" required />
          <Field name="suburb" label="Suburb" />
          <Field name="city" label="City" required />
          <Field name="postcode" label="Postcode" required />
          <button type="submit" className="h-11 rounded bg-signal px-4 text-sm font-black text-white md:col-span-2">Save Address</button>
        </form>
      ) : null}

      {addresses.length ? (
        <div className="grid gap-3">
          {addresses.map((address) => (
            <article key={address.id} className="rounded-lg border border-black/10 bg-zinc-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-black">{address.label}</p>
                  <p className="mt-1 text-sm font-bold text-steel">
                    {address.name}, {address.line1}, {address.suburb ? `${address.suburb}, ` : ""}
                    {address.city} {address.postcode}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="h-10 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink">Edit</button>
                  <button type="button" onClick={() => removeAddress(address.id)} className="h-10 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink">Delete</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No saved addresses yet." />
      )}
    </Panel>
  );
}

function SettingsSection({
  email,
  name,
  setName,
  password,
  setPassword,
  newsletter,
  setNewsletter,
  loading,
  saveSettings
}: {
  email: string;
  name: string;
  setName: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  newsletter: boolean;
  setNewsletter: (value: boolean) => void;
  loading: boolean;
  saveSettings: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Panel title="Account Settings" icon={<Settings className="h-5 w-5" />} className="mt-6">
      <form onSubmit={saveSettings} className="grid gap-4 md:grid-cols-2">
        <TextInput id="settings-name" label="Name" value={name} onChange={setName} />
        <TextInput id="settings-email" label="Email" value={email} onChange={() => undefined} disabled />
        <TextInput id="settings-password" label="Password" type="password" value={password} onChange={setPassword} minLength={6} placeholder="New password" />
        <label className="flex h-12 items-center gap-3 rounded border border-black/10 px-3 md:mt-7">
          <input type="checkbox" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} className="h-4 w-4 accent-red-600" />
          <span className="text-sm font-black">Newsletter Preference</span>
        </label>
        <button type="submit" disabled={loading} className="h-11 rounded bg-signal px-4 text-sm font-black text-white hover:bg-red-700 disabled:bg-zinc-300 md:col-span-2">
          Save Settings
        </button>
      </form>
    </Panel>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3 text-steel">
        {icon}
        <span className="text-xs font-black uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-4 text-2xl font-black text-ink">{value}</p>
    </div>
  );
}

function Panel({ title, icon, children, className = "" }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-black/10 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded bg-zinc-100 text-signal">{icon}</span>
        <h2 className="text-xl font-black">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function OrderSummary({ order }: { order: AccountResponse["orders"][number] }) {
  return (
    <article className="rounded border border-black/10 bg-zinc-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-black text-steel">{order.orderNumber}</p>
          <p className="mt-1 font-black">{order.vehicle ?? "Vehicle not attached"}</p>
        </div>
        <p className="font-black">{formatMoney(order.total)}</p>
      </div>
    </article>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black/10 bg-white p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className="mt-1 text-sm font-black text-ink">{value}</p>
    </div>
  );
}

function OrderButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button type="button" className="inline-flex h-10 items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink">
      {icon}
      {label}
    </button>
  );
}

function AuthModeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-10 items-center justify-center gap-2 rounded text-sm font-black ${active ? "bg-ink text-white" : "text-steel"}`}>
      {icon}
      {label}
    </button>
  );
}

function TextInput({
  id,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  disabled = false,
  minLength,
  placeholder
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-sm font-black" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        disabled={disabled}
        minLength={minLength}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-12 w-full rounded border border-black/10 px-3 outline-none focus:border-ink disabled:bg-zinc-100 disabled:text-steel"
      />
    </div>
  );
}

function Field({ name, label, defaultValue = "", required = false }: { name: string; label: string; defaultValue?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-black">{label}</span>
      <input name={name} required={required} defaultValue={defaultValue} className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold outline-none focus:border-ink" />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-black/10 bg-zinc-50 p-6 text-center text-sm font-bold text-steel">{text}</div>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data as T;
}

function vehicleLabel(vehicle: { make: string; model: string; year: number }) {
  return `${vehicle.make} ${vehicle.model} ${vehicle.year}`.trim();
}

function sameText(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

type FitmentResult = {
  applicationId: string;
  frontPair: { sku: string } | null;
  rearAddon: { id: string } | null;
};

const sections = [
  { id: "dashboard", label: "Dashboard" },
  { id: "orders", label: "Orders" },
  { id: "rewards", label: "Rewards" },
  { id: "vehicles", label: "Saved Vehicles" },
  { id: "addresses", label: "Addresses" },
  { id: "settings", label: "Account Settings" }
];
