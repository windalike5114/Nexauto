"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CarFront, Loader2, Search } from "lucide-react";

type FinderOption = {
  id: string;
  name: string;
};

type FitmentResult = {
  applicationId: string;
  make: string;
  model: string;
  startRaw: string | null;
  endRaw: string | null;
  driverLengthIn: number | null;
  passengerLengthIn: number | null;
  rearLengthIn: number | null;
  frontPair: WiperSetResult | null;
  rearAddon: WiperRearAddonResult | null;
};

type WiperSetResult = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  driverLengthIn: number;
  passengerLengthIn: number;
  price: number;
};

type WiperRearAddonResult = {
  id: string;
  name: string;
  rearLengthIn: number;
  price: number;
};

export function WiperFitmentFinder({
  compact = false,
  directToProduct = false,
  onVehicleSaved
}: {
  compact?: boolean;
  directToProduct?: boolean;
  onVehicleSaved?: () => void;
}) {
  const router = useRouter();
  const [makes, setMakes] = useState<FinderOption[]>([]);
  const [models, setModels] = useState<FinderOption[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [year, setYear] = useState("");
  const [fitments, setFitments] = useState<FitmentResult[]>([]);
  const [loading, setLoading] = useState("makes");
  const [error, setError] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [garageMessage, setGarageMessage] = useState("");
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading("makes");
    fetchJson<{ makes: FinderOption[] }>("/api/fitment/wipers/makes")
      .then((data) => {
        if (active) setMakes(data.makes);
      })
      .catch((nextError) => {
        if (active) setError(nextError.message);
      })
      .finally(() => {
        if (active) setLoading("");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (directToProduct) return;

    let active = true;

    fetchJson<{ profile: { email: string } }>("/api/account")
      .then((data) => {
        if (active) setAccountEmail(data.profile.email);
      })
      .catch(() => {
        if (active) setAccountEmail("");
      });

    return () => {
      active = false;
    };
  }, [directToProduct]);

  useEffect(() => {
    if (!makeId) {
      setModels([]);
      setModelId("");
      return;
    }

    let active = true;
    setLoading("models");
    setError("");
    setModelId("");
    setYear("");
    setYears([]);
    setFitments([]);
    fetchJson<{ models: FinderOption[] }>(`/api/fitment/wipers/models?makeId=${makeId}`)
      .then((data) => {
        if (active) setModels(data.models);
      })
      .catch((nextError) => {
        if (active) setError(nextError.message);
      })
      .finally(() => {
        if (active) setLoading("");
      });

    return () => {
      active = false;
    };
  }, [makeId]);

  useEffect(() => {
    if (!makeId || !modelId) {
      setYears([]);
      setYear("");
      return;
    }

    let active = true;
    setLoading("years");
    setError("");
    setYear("");
    setFitments([]);
    fetchJson<{ years: number[] }>(`/api/fitment/wipers/years?makeId=${makeId}&modelId=${modelId}`)
      .then((data) => {
        if (active) setYears(data.years);
      })
      .catch((nextError) => {
        if (active) setError(nextError.message);
      })
      .finally(() => {
        if (active) setLoading("");
      });

    return () => {
      active = false;
    };
  }, [makeId, modelId]);

  useEffect(() => {
    if (!makeId || !modelId || !year) {
      setFitments([]);
      return;
    }

    if (directToProduct) {
      setFitments([]);
      return;
    }

    let active = true;
    setLoading("results");
    setError("");
    fetchJson<{ fitments: FitmentResult[] }>(`/api/fitment/wipers/results?makeId=${makeId}&modelId=${modelId}&year=${year}`)
      .then((data) => {
        if (active) setFitments(data.fitments);
      })
      .catch((nextError) => {
        if (active) setError(nextError.message);
      })
      .finally(() => {
        if (active) setLoading("");
      });

    return () => {
      active = false;
    };
  }, [directToProduct, makeId, modelId, year]);

  const selectedMake = useMemo(() => makes.find((entry) => entry.id === makeId)?.name ?? "", [makeId, makes]);
  const selectedModel = useMemo(() => models.find((entry) => entry.id === modelId)?.name ?? "", [modelId, models]);
  const busy = Boolean(loading);
  const primaryFitment = fitments[0];
  const selectedVehicle = `${selectedMake} ${selectedModel} ${year}`.trim();

  async function saveVehicleToGarage() {
    if (!primaryFitment || !year) return;

    setSavingVehicle(true);
    setGarageMessage("");

    try {
      await fetchJson("/api/account/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: primaryFitment.applicationId,
          make: selectedMake,
          model: selectedModel,
          year
        })
      });
      setGarageMessage("Saved to your garage.");
      onVehicleSaved?.();
    } catch (nextError) {
      setGarageMessage(nextError instanceof Error ? nextError.message : "Could not save vehicle.");
    } finally {
      setSavingVehicle(false);
    }
  }

  async function findAndGoToProduct() {
    if (!makeId || !modelId || !year) {
      setError("Select make, model, and year first.");
      return;
    }

    setSearching(true);
    setError("");

    try {
      const data = await fetchJson<{ fitments: FitmentResult[] }>(
        `/api/fitment/wipers/results?makeId=${makeId}&modelId=${modelId}&year=${year}`
      );
      const nextFitment = data.fitments.find((entry) => entry.frontPair);

      if (!nextFitment?.frontPair) {
        setError("No active wiper kit exists for this vehicle yet.");
        return;
      }

      router.push(
        buildWiperSkuHref({
          frontPair: nextFitment.frontPair,
          fitment: nextFitment,
          make: selectedMake,
          model: selectedModel,
          year,
          rearAddon: nextFitment.rearAddon
        }) as never
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not find wipers for this vehicle.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className={`rounded-2xl border border-black/10 bg-white shadow-panel ${compact ? "p-5" : "p-7 sm:p-8"}`}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-signal">
            <CarFront className="h-4 w-4" />
            Wiper fitment
          </div>
          <h2 className={`${compact ? "mt-2 text-2xl" : "mt-3 text-3xl"} font-black`}>Find wiper sizes by vehicle</h2>
          <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-steel">
            Select make, model, and year to check blade lengths before choosing your wiper variant.
          </p>
        </div>
        <div className="hidden h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink text-white shadow-sm sm:grid">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
        </div>
      </div>

      <div className={`mt-6 grid gap-4 ${compact ? "grid-cols-1" : "md:grid-cols-3"}`}>
        <SelectControl label="Make" value={makeId} disabled={busy && loading === "makes"} onChange={setMakeId}>
          <option value="">Select make</option>
          {makes.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </SelectControl>

        <SelectControl label="Model" value={modelId} disabled={!makeId || loading === "models"} onChange={setModelId}>
          <option value="">Select model</option>
          {models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </SelectControl>

        <SelectControl label="Year" value={year} disabled={!modelId || loading === "years"} onChange={setYear}>
          <option value="">Select year</option>
          {years.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </SelectControl>
      </div>

      {directToProduct ? (
        <button
          type="button"
          disabled={!makeId || !modelId || !year || searching}
          onClick={findAndGoToProduct}
          className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-signal px-5 py-4 text-sm font-black text-white shadow-lg shadow-red-900/15 transition hover:-translate-y-0.5 hover:bg-red-700 hover:shadow-xl disabled:translate-y-0 disabled:bg-zinc-300 disabled:shadow-none"
        >
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Find wipers for my car
        </button>
      ) : null}

      {error ? <div className="mt-4 rounded border border-signal/30 bg-red-50 p-3 text-sm font-bold text-signal">{error}</div> : null}

      {!directToProduct && year && !busy && !error ? (
        <div className="mt-5">
          {primaryFitment ? (
            <div className="grid gap-3 lg:grid-cols-[1fr_320px] lg:items-stretch">
              <div className="rounded border border-black/10 bg-zinc-50 p-4">
                <p className="text-sm font-black">
                  {selectedMake} {selectedModel} {year}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <LengthPill label="Driver" value={primaryFitment.driverLengthIn} />
                  <LengthPill label="Passenger" value={primaryFitment.passengerLengthIn} />
                  <LengthPill label="Rear" value={primaryFitment.rearLengthIn} />
                </div>
                <p className="mt-3 text-xs font-bold text-steel">
                  Fitment range: {primaryFitment.startRaw ?? "?"} - {primaryFitment.endRaw ?? "?"}. Connector is handled internally.
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                  {accountEmail ? (
                    <button
                      type="button"
                      disabled={savingVehicle}
                      onClick={saveVehicleToGarage}
                      className="inline-flex h-10 items-center justify-center rounded border border-black/10 bg-white px-4 text-sm font-black text-ink hover:border-ink disabled:text-steel"
                    >
                      {savingVehicle ? "Saving..." : "Save to my garage"}
                    </button>
                  ) : (
                    <Link
                      href="/account"
                      className="inline-flex h-10 items-center justify-center rounded border border-black/10 bg-white px-4 text-sm font-black text-ink hover:border-ink"
                    >
                      Sign in to save vehicle
                    </Link>
                  )}
                  {garageMessage ? <p className="text-xs font-bold text-steel">{garageMessage}</p> : null}
                </div>
              </div>
              <div className="flex flex-col justify-between rounded border border-black/10 bg-white p-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Matched result</p>
                  <h3 className="mt-2 text-xl font-black">Your wiper kit is ready</h3>
                  <p className="mt-2 text-sm font-bold leading-6 text-steel">
                    Continue to the product page with your vehicle, blade lengths, rear option, and add-to-cart controls already configured.
                  </p>
                </div>

                {primaryFitment.frontPair ? (
                  <Link
                    href={
                      buildWiperSkuHref({
                        frontPair: primaryFitment.frontPair,
                        fitment: primaryFitment,
                        make: selectedMake,
                        model: selectedModel,
                        year,
                        rearAddon: primaryFitment.rearAddon
                      }) as never
                    }
                    className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-signal px-4 text-sm font-black text-white hover:bg-red-700"
                  >
                    Find wipers for my car
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <div className="mt-5 rounded bg-zinc-50 p-3 text-sm font-bold text-steel">
                    No active SKU exists for this blade combination yet.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded border border-black/10 bg-zinc-50 p-4 text-sm font-bold text-steel">
              No wiper length data found for this vehicle yet.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SelectControl({
  label,
  value,
  disabled,
  onChange,
  children
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-12 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold text-ink outline-none disabled:bg-zinc-100 disabled:text-steel"
      >
        {children}
      </select>
    </label>
  );
}

function LengthPill({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded border border-black/10 bg-white p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className="mt-1 text-2xl font-black">{value ? `${value}"` : "N/A"}</p>
    </div>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "Fitment request failed.");
  }

  return data as T;
}

function buildWiperSkuHref({
  frontPair,
  fitment,
  make,
  model,
  year,
  rearAddon
}: {
  frontPair: WiperSetResult;
  fitment: FitmentResult;
  make: string;
  model: string;
  year: string;
  rearAddon: WiperRearAddonResult | null;
}) {
  const params = new URLSearchParams();
  const vehicle = `${make} ${model} ${year}`.trim();

  if (vehicle) params.set("vehicle", vehicle);
  if (fitment.applicationId) params.set("applicationId", fitment.applicationId);
  if (make) params.set("make", make);
  if (model) params.set("model", model);
  if (year) params.set("year", year);
  if (rearAddon) params.set("rearAddonId", rearAddon.id);

  const query = params.toString();
  return query ? `/wipers/${frontPair.sku}?${query}` : `/wipers/${frontPair.sku}`;
}
