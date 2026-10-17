"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BatteryCharging, CarFront, Filter, Lightbulb, Loader2, Search, Wrench } from "lucide-react";

type FinderOption = { id: string; name: string };

const categoryOptions = [
  { slug: "wipers", name: "Wipers", description: "Front and rear blades", icon: Search, live: true },
  { slug: "bulbs", name: "Light Bulbs", description: "Headlight and exterior bulbs", icon: Lightbulb, live: false },
  { slug: "batteries", name: "Batteries", description: "Size, terminals and CCA", icon: BatteryCharging, live: false },
  { slug: "filters", name: "Filters", description: "Oil, air, cabin and fuel", icon: Filter, live: false },
  { slug: "suspension", name: "Suspension", description: "Shocks, struts and arms", icon: Wrench, live: false }
] as const;

export function VehiclePartsFinder() {
  const router = useRouter();
  const [makes, setMakes] = useState<FinderOption[]>([]);
  const [models, setModels] = useState<FinderOption[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [year, setYear] = useState("");
  const [loading, setLoading] = useState("makes");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchJson<{ makes: FinderOption[] }>("/api/vehicles/makes")
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
    if (!makeId) {
      setModels([]);
      setModelId("");
      setYears([]);
      setYear("");
      return;
    }

    let active = true;
    setLoading("models");
    setError("");
    setModelId("");
    setYears([]);
    setYear("");
    fetchJson<{ models: FinderOption[] }>(`/api/vehicles/models?makeId=${makeId}`)
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
    fetchJson<{ years: number[] }>(`/api/vehicles/years?makeId=${makeId}&modelId=${modelId}`)
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

  const selectedMake = useMemo(() => makes.find((entry) => entry.id === makeId)?.name ?? "", [makeId, makes]);
  const selectedModel = useMemo(() => models.find((entry) => entry.id === modelId)?.name ?? "", [modelId, models]);
  const vehicleReady = Boolean(makeId && modelId && year);

  function openCategory(slug: (typeof categoryOptions)[number]["slug"]) {
    if (!vehicleReady) return;
    const context = { makeId, modelId, year, make: selectedMake, model: selectedModel };
    window.localStorage.setItem("nexauto.vehicle-context.v1", JSON.stringify(context));
    const query = new URLSearchParams({ makeId, modelId, year, make: selectedMake, model: selectedModel });
    router.push((slug === "wipers" ? `/shop?${query}#vehicle-finder` : `/parts/${slug}?${query}`) as never);
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5 text-ink shadow-panel sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-signal">
            <CarFront className="h-4 w-4" /> Vehicle finder
          </div>
          <h2 className="mt-2 text-2xl font-black leading-tight sm:text-3xl">What do you drive?</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-steel">Choose the vehicle once, then select the part category you need.</p>
        </div>
        <div className="hidden h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink text-white sm:grid">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <SelectControl label="Make" value={makeId} disabled={loading === "makes"} onChange={setMakeId}>
          <option value="">Select make</option>
          {makes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </SelectControl>
        <SelectControl label="Model" value={modelId} disabled={!makeId || loading === "models"} onChange={setModelId}>
          <option value="">Select model</option>
          {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </SelectControl>
        <SelectControl label="Year" value={year} disabled={!modelId || loading === "years"} onChange={setYear}>
          <option value="">Select year</option>
          {years.map((entry) => <option key={entry} value={String(entry)}>{entry}</option>)}
        </SelectControl>
      </div>

      <div className="mt-5 border-t border-black/10 pt-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Choose a part category</p>
            <p className="mt-1 text-sm font-black">{vehicleReady ? `${year} ${selectedMake} ${selectedModel}` : "Select make, model and year first"}</p>
          </div>
          <p className="text-xs font-bold text-steel">Each category can ask for more vehicle details.</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {categoryOptions.map((category) => {
            const Icon = category.icon;
            return (
              <button
                key={category.slug}
                type="button"
                disabled={!vehicleReady}
                onClick={() => openCategory(category.slug)}
                className="group min-h-[104px] rounded-xl border border-black/10 bg-[#F8FAFC] p-3 text-left transition hover:-translate-y-0.5 hover:border-signal hover:bg-white hover:shadow-md disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Icon className="h-5 w-5 text-signal" />
                <span className="mt-3 block text-sm font-black">{category.name}</span>
                <span className="mt-1 block text-[11px] font-bold leading-4 text-steel">{category.description}</span>
                <span className={`mt-2 block text-[10px] font-black uppercase tracking-[0.1em] ${category.live ? "text-emerald-700" : "text-steel"}`}>
                  {category.live ? "Finder live" : "Own fitment source"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error ? <div className="mt-4 rounded-lg border border-signal/25 bg-red-50 p-3 text-sm font-bold text-signal">{error}</div> : null}
    </section>
  );
}

function SelectControl({ label, value, disabled, onChange, children }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.13em] text-steel">{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-black/10 bg-white px-3 text-base font-bold outline-none disabled:bg-zinc-100 disabled:text-steel sm:text-sm">
        {children}
      </select>
    </label>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Vehicle request failed.");
  return data as T;
}
