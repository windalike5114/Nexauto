"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BatteryCharging, CarFront, Filter, Lightbulb, Loader2, Pencil, Search, Wrench } from "lucide-react";
import { saveVehicleContext } from "@/lib/vehicle-context";

type FinderOption = { id: string; name: string };
type VehicleApplicationOption = {
  id: string;
  generationId: string;
  variantId: string;
  chassisCodes: string[];
  generationName: string;
  bodyConfiguration: string;
  bodyStyle: string;
  engine: string;
  yearStart: number;
  yearEnd: number | null;
};

const vehicleCatalogApiVersion = "v3";

const categoryOptions = [
  { slug: "wipers", name: "Wiper Blades", description: "Front and rear blades", icon: Search },
  { slug: "filters", name: "Oil Filters", description: "Engine-specific filters", icon: Filter },
  { slug: "bulbs", name: "Light Bulbs", description: "Headlight and exterior", icon: Lightbulb },
  { slug: "batteries", name: "Batteries", description: "Size, terminals and CCA", icon: BatteryCharging },
  { slug: "suspension", name: "Control Arms", description: "Position-specific parts", icon: Wrench }
] as const;

export function VehiclePartsFinder() {
  const router = useRouter();
  const [makes, setMakes] = useState<FinderOption[]>([]);
  const [models, setModels] = useState<FinderOption[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [applications, setApplications] = useState<VehicleApplicationOption[]>([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [year, setYear] = useState("");
  const [generationId, setGenerationId] = useState("");
  const [bodyConfiguration, setBodyConfiguration] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [showCategories, setShowCategories] = useState(false);
  const [loading, setLoading] = useState("makes");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchJson<{ makes: FinderOption[] }>(`/api/vehicles/makes?catalog=${vehicleCatalogApiVersion}`)
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
      setShowCategories(false);
      setModels([]);
      setModelId("");
      setYears([]);
      setYear("");
      resetApplicationSelection();
      return;
    }

    let active = true;
    setLoading("models");
    setShowCategories(false);
    setError("");
    setModelId("");
    setYears([]);
    setYear("");
    resetApplicationSelection();
    fetchJson<{ models: FinderOption[] }>(`/api/vehicles/models?makeId=${makeId}&catalog=${vehicleCatalogApiVersion}`)
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
      resetApplicationSelection();
      return;
    }

    let active = true;
    setLoading("years");
    setShowCategories(false);
    setError("");
    setYear("");
    resetApplicationSelection();
    fetchJson<{ years: number[] }>(`/api/vehicles/years?makeId=${makeId}&modelId=${modelId}&catalog=${vehicleCatalogApiVersion}`)
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
      resetApplicationSelection();
      return;
    }

    let active = true;
    setLoading("applications");
    setShowCategories(false);
    setError("");
    resetApplicationSelection();
    fetchJson<{ applications: VehicleApplicationOption[] }>(`/api/vehicles/applications?makeId=${makeId}&modelId=${modelId}&year=${year}&catalog=${vehicleCatalogApiVersion}`)
      .then((data) => {
        if (!active) return;
        setApplications(data.applications);
        const generationIds = [...new Set(data.applications.map((entry) => entry.generationId))];
        setGenerationId(generationIds.length === 1 ? generationIds[0] : "");
        if (data.applications.length === 0) setError("No published vehicle configuration was found for this year.");
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
  }, [makeId, modelId, year]);

  const chassisOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const application of applications) {
      options.set(application.generationId, application.chassisCodes.join(" / ") || application.generationName);
    }
    return [...options].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [applications]);

  const bodyOptions = useMemo(() => {
    const options = new Set(
      applications
        .filter((entry) => entry.generationId === generationId)
        .map((entry) => entry.bodyConfiguration)
    );
    return [...options].sort((left, right) => left.localeCompare(right));
  }, [applications, generationId]);

  const engineOptions = useMemo(() => applications
    .filter((entry) => entry.generationId === generationId && entry.bodyConfiguration === bodyConfiguration)
    .sort((left, right) => left.engine.localeCompare(right.engine)), [applications, bodyConfiguration, generationId]);

  useEffect(() => {
    setShowCategories(false);
    setApplicationId("");
    setBodyConfiguration(bodyOptions.length === 1 ? bodyOptions[0] : "");
  }, [bodyOptions]);

  useEffect(() => {
    setShowCategories(false);
    setApplicationId(engineOptions.length === 1 ? engineOptions[0].id : "");
  }, [engineOptions]);

  const selectedMake = useMemo(() => makes.find((entry) => entry.id === makeId)?.name ?? "", [makeId, makes]);
  const selectedModel = useMemo(() => models.find((entry) => entry.id === modelId)?.name ?? "", [modelId, models]);
  const selectedApplication = useMemo(() => applications.find((entry) => entry.id === applicationId) ?? null, [applicationId, applications]);
  const selectedChassis = selectedApplication?.chassisCodes.join(" / ") || selectedApplication?.generationName || "";
  const vehicleReady = Boolean(makeId && modelId && year && selectedApplication);

  function confirmVehicle() {
    const context = getSelectedVehicleContext();
    if (!context) return;
    saveVehicleContext(context);
    setShowCategories(true);
  }

  function openCategory(slug: (typeof categoryOptions)[number]["slug"]) {
    const context = getSelectedVehicleContext();
    if (!context) return;
    saveVehicleContext(context);
    const query = new URLSearchParams({
      makeId,
      modelId,
      year,
      make: selectedMake,
      model: selectedModel,
      applicationId: context.applicationId,
      generationId: context.generationId,
      variantId: context.variantId,
      chassis: context.chassis,
      body: context.bodyConfiguration,
      engine: context.engine
    });
    router.push(`/parts/${slug}?${query}#vehicle-finder` as never);
  }

  function getSelectedVehicleContext() {
    if (!selectedApplication) return null;
    return {
      makeId,
      modelId,
      year,
      make: selectedMake,
      model: selectedModel,
      applicationId: selectedApplication.id,
      generationId: selectedApplication.generationId,
      variantId: selectedApplication.variantId,
      chassis: selectedChassis,
      bodyConfiguration: selectedApplication.bodyConfiguration,
      engine: selectedApplication.engine
    };
  }

  function resetApplicationSelection() {
    setApplications([]);
    setGenerationId("");
    setBodyConfiguration("");
    setApplicationId("");
  }

  return (
    <section className={`rounded-2xl border border-black/10 bg-white p-4 text-ink shadow-panel transition-all duration-200 sm:p-5 ${showCategories ? "vehicle-selected" : ""}`}>
      {showCategories && vehicleReady ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-signal text-white"><CarFront className="h-5 w-5" /></span>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">Your selected vehicle</p>
              <h2 className="mt-0.5 text-base font-black sm:text-lg">{year} {selectedMake} {selectedModel} · {selectedChassis}</h2>
              <p className="mt-1 text-xs font-bold text-steel">{selectedApplication?.bodyConfiguration} · {selectedApplication?.engine}</p>
            </div>
          </div>
          <button type="button" onClick={() => setShowCategories(false)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-black/10 px-3 text-xs font-black hover:border-black/30 hover:bg-[#F8FAFC]"><Pencil className="h-3.5 w-3.5" /> Change vehicle</button>
        </div>
      ) : <div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-signal">
            <CarFront className="h-4 w-4" /> My Vehicle
          </div>
          <h2 className="mt-1 text-xl font-black leading-tight">Find compatible parts</h2>
          <p className="mt-1 text-[11px] font-bold text-steel">New NexAuto vehicle catalogue</p>
          </div>
          <p className="text-xs font-bold text-steel">Make → Model → Year → Chassis → Body / drivetrain → Engine</p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <SelectControl label="Make" value={makeId} disabled={loading === "makes"} onChange={(value) => { setShowCategories(false); setMakeId(value); }}>
          <option value="">Select make</option>
          {makes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </SelectControl>
        <SelectControl label="Model" value={modelId} disabled={!makeId || loading === "models"} onChange={(value) => { setShowCategories(false); setModelId(value); }}>
          <option value="">Select model</option>
          {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </SelectControl>
        <SelectControl label="Year" value={year} disabled={!modelId || loading === "years"} onChange={(value) => { setShowCategories(false); setYear(value); }}>
          <option value="">Select year</option>
          {years.map((entry) => <option key={entry} value={String(entry)}>{entry}</option>)}
        </SelectControl>
        <SelectControl label="Chassis / code" value={generationId} disabled={!year || loading === "applications" || chassisOptions.length === 0} onChange={setGenerationId}>
          <option value="">Select chassis</option>
          {chassisOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </SelectControl>
        <SelectControl label="Body / drivetrain" value={bodyConfiguration} disabled={!generationId || bodyOptions.length === 0} onChange={setBodyConfiguration}>
          <option value="">Select body / drivetrain</option>
          {bodyOptions.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </SelectControl>
        <SelectControl label="Engine" value={applicationId} disabled={!bodyConfiguration || engineOptions.length === 0} onChange={setApplicationId}>
          <option value="">Select engine</option>
          {engineOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.engine}</option>)}
        </SelectControl>
        </div>

        <button type="button" disabled={!vehicleReady || Boolean(loading)} onClick={confirmVehicle} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-signal px-5 text-sm font-black text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300 sm:w-auto sm:min-w-[180px]">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Find Parts
        </button>
      </div>}

      {showCategories && vehicleReady ? <div className="mt-4 border-t border-black/10 pt-4">
        <p className="text-xs font-bold text-steel">Choose a part category. Each category will ask only for the additional details it needs.</p>
        <div className="mt-3 grid auto-cols-[150px] grid-flow-col gap-2 overflow-x-auto pb-1 snap-x snap-mandatory sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-5 sm:overflow-visible sm:pb-0">
          {categoryOptions.map((category) => {
            const Icon = category.icon;
            return (
              <button
                key={category.slug}
                type="button"
                disabled={!vehicleReady}
                onClick={() => openCategory(category.slug)}
                className="group min-h-[86px] snap-start rounded-xl border border-black/10 bg-[#F8FAFC] p-3 text-left transition hover:-translate-y-0.5 hover:border-signal hover:bg-white hover:shadow-md"
              >
                <Icon className="h-5 w-5 text-signal" />
                <span className="mt-3 block text-sm font-black">{category.name}</span>
                <span className="mt-1 block text-[11px] font-bold leading-4 text-steel">{category.description}</span>
              </button>
            );
          })}
        </div>
      </div> : null}

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
