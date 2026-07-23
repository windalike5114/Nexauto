"use client";

import { useEffect, useMemo, useState } from "react";
import { Edit3, Loader2, MapPin, Plus, Star, Trash2 } from "lucide-react";

export type AccountAddress = {
  id: string;
  label: string | null;
  recipientName: string;
  company: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  suburb: string | null;
  city: string;
  region: string | null;
  postcode: string;
  country: "NZ";
  isDefaultShipping: boolean;
};

type LegacyAddress = {
  id?: string;
  label?: string;
  name?: string;
  line1?: string;
  suburb?: string;
  city?: string;
  postcode?: string;
  isDefault?: boolean;
};

export function AccountAddressesSection({ email }: { email: string }) {
  const [addresses, setAddresses] = useState<AccountAddress[]>([]);
  const [legacyAddresses, setLegacyAddresses] = useState<LegacyAddress[]>([]);
  const [editing, setEditing] = useState<AccountAddress | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [migrationComplete, setMigrationComplete] = useState(false);
  const normalizedEmail = email.trim().toLowerCase();
  const migrationKey = `nexauto_address_migration_v1:${normalizedEmail}`;
  const legacyKey = `nexauto-addresses-${email}`;

  useEffect(() => {
    void loadAddresses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const defaultAddress = useMemo(() => addresses.find((address) => address.isDefaultShipping) ?? null, [addresses]);

  async function loadAddresses() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/addresses");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load addresses.");
      const nextAddresses = (data.addresses ?? []) as AccountAddress[];
      setAddresses(nextAddresses);
      await handleLegacyImport(nextAddresses);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load addresses.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLegacyImport(databaseAddresses: AccountAddress[]) {
    const legacy = readLegacyAddresses(legacyKey);
    setLegacyAddresses(legacy);
    const complete = window.localStorage.getItem(migrationKey) === "complete";
    setMigrationComplete(complete);
    if (!legacy.length || complete) return;

    if (databaseAddresses.length > 0) return;

    const result = await importLegacyAddresses(legacy);
    if (result.ok) {
      window.localStorage.setItem(migrationKey, "complete");
      setMigrationComplete(true);
      setAddresses(result.addresses);
      setMessage(`Imported ${result.imported} saved address${result.imported === 1 ? "" : "es"}.`);
    }
  }

  async function importLegacyAddresses(addressesToImport = legacyAddresses) {
    const response = await fetch("/api/account/addresses/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: addressesToImport })
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Saved addresses could not be imported.");
      return { ok: false as const, addresses: [] as AccountAddress[], imported: 0 };
    }
    setAddresses((data.addresses ?? []) as AccountAddress[]);
    window.localStorage.setItem(migrationKey, "complete");
    setMigrationComplete(true);
    setMessage(`Imported ${data.imported ?? 0} address${data.imported === 1 ? "" : "es"}; skipped ${data.skipped ?? 0}.`);
    return { ok: true as const, addresses: (data.addresses ?? []) as AccountAddress[], imported: Number(data.imported ?? 0) };
  }

  async function saveAddress(form: HTMLFormElement) {
    setSaving(true);
    setMessage("");
    const formData = new FormData(form);
    const payload = {
      label: stringValue(formData, "label"),
      recipientName: stringValue(formData, "recipientName"),
      company: stringValue(formData, "company"),
      phone: stringValue(formData, "phone"),
      line1: stringValue(formData, "line1"),
      line2: stringValue(formData, "line2"),
      suburb: stringValue(formData, "suburb"),
      city: stringValue(formData, "city"),
      region: stringValue(formData, "region"),
      postcode: stringValue(formData, "postcode"),
      country: "NZ",
      isDefaultShipping: formData.get("isDefaultShipping") === "on"
    };

    try {
      const url = editing ? `/api/account/addresses/${editing.id}` : "/api/account/addresses";
      const response = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Address could not be saved.");
      setShowForm(false);
      setEditing(null);
      await loadAddresses();
      setMessage(editing ? "Address updated." : "Address saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Address could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAddress(addressId: string) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/account/addresses/${addressId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Address could not be deleted.");
      await loadAddresses();
      setMessage("Address deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Address could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  async function setDefault(addressId: string) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/account/addresses/${addressId}/default`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Default address could not be updated.");
      await loadAddresses();
      setMessage("Default shipping address updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Default address could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded bg-zinc-100 text-signal">
          <MapPin className="h-5 w-5" />
        </span>
        <h2 className="text-xl font-black">Addresses</h2>
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-ink">Default Shipping Address</p>
          <p className="mt-1 text-sm font-bold text-steel">{defaultAddress ? formatAddress(defaultAddress) : "No default address"}</p>
        </div>
        <button type="button" onClick={() => { setEditing(null); setShowForm(!showForm); }} className="inline-flex h-11 items-center justify-center gap-2 rounded bg-ink px-4 text-sm font-black text-white">
          <Plus className="h-4 w-4" />
          Add Address
        </button>
      </div>

      {legacyAddresses.length > 0 && addresses.length > 0 && !migrationComplete ? (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          <p>Local saved addresses were found on this browser.</p>
          <button type="button" onClick={() => void importLegacyAddresses()} className="mt-3 h-10 rounded bg-ink px-4 text-xs font-black text-white">
            Import saved addresses
          </button>
        </div>
      ) : null}

      {message ? <p className="mb-4 rounded bg-zinc-50 p-3 text-sm font-bold text-steel">{message}</p> : null}

      {showForm ? (
        <AddressForm address={editing} saving={saving} onSave={(form) => void saveAddress(form)} onCancel={() => { setShowForm(false); setEditing(null); }} />
      ) : null}

      {loading ? (
        <div className="grid place-items-center rounded-lg border border-black/10 bg-zinc-50 p-8">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
        </div>
      ) : addresses.length ? (
        <div className="grid gap-3">
          {addresses.map((address) => (
            <article key={address.id} className="rounded-lg border border-black/10 bg-zinc-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black">{address.label ?? "Shipping"}</p>
                    {address.isDefaultShipping ? <span className="rounded bg-red-50 px-2 py-1 text-xs font-black text-signal">Default</span> : null}
                  </div>
                  <p className="mt-1 text-sm font-bold text-steel">{address.recipientName}</p>
                  <p className="mt-1 text-sm font-bold text-steel">{formatAddress(address)}</p>
                  {address.phone ? <p className="mt-1 text-xs font-bold text-steel">{address.phone}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {!address.isDefaultShipping ? (
                    <button type="button" onClick={() => void setDefault(address.id)} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink disabled:text-steel">
                      <Star className="h-4 w-4" />
                      Set default
                    </button>
                  ) : null}
                  <button type="button" onClick={() => { setEditing(address); setShowForm(true); }} className="inline-flex h-10 items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink">
                    <Edit3 className="h-4 w-4" />
                    Edit
                  </button>
                  <button type="button" onClick={() => void deleteAddress(address.id)} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink disabled:text-steel">
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-black/10 bg-zinc-50 p-6 text-center text-sm font-bold text-steel">
          No saved addresses yet.
        </div>
      )}
    </section>
  );
}

function AddressForm({
  address,
  saving,
  onSave,
  onCancel
}: {
  address: AccountAddress | null;
  saving: boolean;
  onSave: (form: HTMLFormElement) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSave(event.currentTarget); }} className="mb-5 grid gap-3 rounded-lg border border-black/10 bg-zinc-50 p-4 md:grid-cols-2">
      <Field name="label" label="Address label" defaultValue={address?.label ?? "Home" } />
      <Field name="recipientName" label="Recipient name" defaultValue={address?.recipientName ?? ""} required />
      <Field name="company" label="Company" defaultValue={address?.company ?? ""} />
      <Field name="phone" label="Phone" defaultValue={address?.phone ?? ""} />
      <Field name="line1" label="Address line 1" defaultValue={address?.line1 ?? ""} required />
      <Field name="line2" label="Address line 2" defaultValue={address?.line2 ?? ""} />
      <Field name="suburb" label="Suburb" defaultValue={address?.suburb ?? ""} />
      <Field name="city" label="City" defaultValue={address?.city ?? ""} required />
      <Field name="region" label="Region" defaultValue={address?.region ?? ""} />
      <Field name="postcode" label="Postcode" defaultValue={address?.postcode ?? ""} required pattern="\\d{4}" />
      <label className="flex h-11 items-center gap-3 rounded border border-black/10 bg-white px-3 md:col-span-2">
        <input name="isDefaultShipping" type="checkbox" defaultChecked={address?.isDefaultShipping ?? false} className="h-4 w-4 accent-red-600" />
        <span className="text-sm font-black">Set as default shipping address</span>
      </label>
      <div className="grid gap-2 md:col-span-2 sm:grid-cols-2">
        <button type="button" onClick={onCancel} className="h-11 rounded border border-black/10 bg-white px-4 text-sm font-black text-ink">
          Cancel
        </button>
        <button type="button" onClick={(event) => { const form = event.currentTarget.form; if (form?.reportValidity()) onSave(form); }} disabled={saving} className="h-11 rounded bg-signal px-4 text-sm font-black text-white disabled:bg-zinc-300">
          {saving ? "Saving..." : address ? "Update Address" : "Save Address"}
        </button>
      </div>
    </form>
  );
}

function Field({ name, label, defaultValue = "", required = false, pattern }: { name: string; label: string; defaultValue?: string; required?: boolean; pattern?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-black">{label}</span>
      <input name={name} required={required} pattern={pattern} defaultValue={defaultValue} className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold outline-none focus:border-ink" />
    </label>
  );
}

function readLegacyAddresses(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LegacyAddress[]) : [];
  } catch {
    return [];
  }
}

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function formatAddress(address: AccountAddress) {
  return [address.line1, address.line2, address.suburb, address.city, address.region, address.postcode, address.country].filter(Boolean).join(", ");
}
