"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AccountAddressesSection } from "@/components/account/addresses-section";
import { AccountLoading } from "@/components/account/account-loading";
import { AccountShell } from "@/components/account/account-shell";
import { AuthPanel } from "@/components/account/auth-panel";
import { DashboardSection } from "@/components/account/dashboard-section";
import { OrdersSection } from "@/components/account/orders-section";
import { RewardsSection } from "@/components/account/rewards-section";
import { SettingsSection } from "@/components/account/settings-section";
import { VehiclesSection } from "@/components/account/vehicles-section";
import type { AccountMode, AccountResponse, AccountSectionId, AccountVehicle, FitmentResult } from "@/components/account/account-types";
import { sameText, vehicleLabel } from "@/components/account/account-types";
import { getSafeAuthErrorMessage } from "@/lib/domain/account/auth-errors";
import {
  getAuthCallbackUrl,
  getFirstValidationMessage,
  parsePasswordResetInput,
  parseSignInInput,
  parseSignUpInput
} from "@/lib/domain/account/auth.schema";
import { createClient } from "@/utils/supabase/client";

export function AccountAuth({ initialMode = "sign-in" }: { initialMode?: AccountMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<AccountMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [activeSection, setActiveSection] = useState<AccountSectionId>("dashboard");
  const [vehicleActionId, setVehicleActionId] = useState("");
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

    const newsletterKey = `nexauto-newsletter-${account.profile.email}`;
    const storedNewsletter = window.localStorage.getItem(newsletterKey);

    setNewsletter(storedNewsletter ? storedNewsletter === "true" : true);
    setSettingsName(account.profile.name ?? "");
  }, [account]);

  const defaultVehicle = useMemo(
    () => account?.vehicles.find((vehicle) => vehicle.isDefault) ?? account?.vehicles[0] ?? null,
    [account]
  );
  const recentOrders = account?.orders.slice(0, 3) ?? [];

  async function loadAccount() {
    setCheckingSession(true);

    try {
      const response = await fetch("/api/account");
      if (!response.ok) {
        setAccount(null);
        setCheckingSession(false);
        return;
      }

      const data = (await response.json()) as AccountResponse;
      setAccount(data);
      setCheckingSession(false);
    } catch {
      setAccount(null);
      setCheckingSession(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setMessage("");

    try {
      const supabase = createClient();
      const callbackUrl = getAuthCallbackUrl(window.location.origin, "/account");

      if (mode === "reset-password") {
        const input = parsePasswordResetInput({ email });
        const { error } = await supabase.auth.resetPasswordForEmail(input.email, { redirectTo: callbackUrl });
        if (error) throw error;
        setMessage("If an account exists for this email, password reset instructions will be sent.");
        return;
      }

      if (mode === "sign-in") {
        const input = parseSignInInput({ email, password });
        const { error } = await supabase.auth.signInWithPassword(input);
        if (error) throw error;
        setMessage("Signed in successfully.");
        await loadAccount();
        return;
      }

      const input = parseSignUpInput({ name, email, password, confirmPassword });
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          emailRedirectTo: callbackUrl,
          data: input.name ? { name: input.name } : undefined
        }
      });

      if (error) throw error;

      window.sessionStorage.setItem("nexauto-welcome-registration-success", "true");
      window.dispatchEvent(new CustomEvent("nexauto:analytics", { detail: { event: "registration_completed" } }));

      if (data.session) {
        window.dispatchEvent(new CustomEvent("nexauto:welcome-reward-ready"));
        setMessage("Account created and signed in.");
        await loadAccount();
        return;
      }

      setMode("sign-up");
      setMessage("Account created. Please check your email to confirm your account before signing in.");
    } catch (error) {
      const validationMessage = getFirstValidationMessage(error);
      setMessage(validationMessage === "Please check the form and try again." ? getSafeAuthErrorMessage(error) : validationMessage);
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    setAccount(null);
    setLoading(false);
  }

  async function saveDefaultVehicle(vehicleId: string) {
    setVehicleActionId(vehicleId);
    setMessage("");

    try {
      const response = await fetch("/api/account/vehicles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vehicleId, isDefault: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update default vehicle.");
      await loadAccount();
      setMessage("Default vehicle updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update default vehicle.");
    } finally {
      setVehicleActionId("");
    }
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

  async function findWipers(vehicle: AccountVehicle) {
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
      setMessage(getSafeAuthErrorMessage(error, "Could not update account settings. Please try again."));
      return;
    }

    window.localStorage.setItem(`nexauto-newsletter-${account.profile.email}`, String(newsletter));
    setSettingsPassword("");
    setMessage("Account settings saved.");
    await loadAccount();
  }

  if (checkingSession) {
    return <AccountLoading />;
  }

  if (!account) {
    return (
      <AuthPanel
        mode={mode}
        setMode={setMode}
        name={name}
        setName={setName}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
        loading={loading}
        message={message}
        submit={submit}
      />
    );
  }

  return (
    <AccountShell
      account={account}
      activeSection={activeSection}
      setActiveSection={setActiveSection}
      loading={loading}
      message={message}
      signOut={signOut}
    >
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
          busyVehicleId={vehicleActionId}
          setDefaultVehicle={saveDefaultVehicle}
          removeVehicle={removeVehicle}
          findWipers={findWipers}
          refresh={loadAccount}
        />
      ) : null}
      {activeSection === "addresses" ? <AccountAddressesSection email={account.profile.email} /> : null}
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
    </AccountShell>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data as T;
}
