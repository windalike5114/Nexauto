"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CarFront, Loader2, Search } from "lucide-react";
import { saveVehicleContext, type VehicleContext } from "@/lib/vehicle-context";

type FinderOption = { id: string; name: string };
type FinderModelOption = FinderOption & { years: number[] };
type FinderMakeOption = FinderOption & { models: FinderModelOption[] };
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
const vehicleRequestCache = new Map<string, Promise<unknown>>();

export function VehiclePartsFinder({ compact = false, category }: { compact?: boolean; category?: string } = {}) {
  const router = useRouter();
  const [catalogMakes, setCatalogMakes] = useState<FinderMakeOption[]>([]);
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
  const [loading, setLoading] = useState("makes");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchJsonCached<{ makes: FinderMakeOption[] }>(`/api/vehicles/catalog?catalog=${vehicleCatalogApiVersion}`)
      .then((data) => {
        if (!active) return;
        setCatalogMakes(data.makes);
        setMakes(data.makes.map(({ id, name }) => ({ id, name })));
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
      resetApplicationSelection();
      return;
    }

    setError("");
    setModelId("");
    setYears([]);
    setYear("");
    resetApplicationSelection();
    setModels(catalogMakes.find((entry) => entry.id === makeId)?.models.map(({ id, name }) => ({ id, name })) ?? []);
  }, [catalogMakes, makeId]);

  useEffect(() => {
    if (!makeId || !modelId) {
      setYears([]);
      setYear("");
      resetApplicationSelection();
      return;
    }

    setError("");
    setYear("");
    resetApplicationSelection();
    const make = catalogMakes.find((entry) => entry.id === makeId);
    setYears(make?.models.find((entry) => entry.id === modelId)?.years ?? []);
  }, [catalogMakes, makeId, modelId]);

  useEffect(() => {
    if (!makeId || !modelId || !year) {
      resetApplicationSelection();
      return;
    }

    let active = true;
    setLoading("applications");
    setError("");
    resetApplicationSelection();
    fetchJsonCached<{ applications: VehicleApplicationOption[] }>(`/api/vehicles/applications?makeId=${makeId}&modelId=${modelId}&year=${year}&catalog=${vehicleCatalogApiVersion}`)
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
    setApplicationId("");
    setBodyConfiguration(bodyOptions.length === 1 ? bodyOptions[0] : "");
  }, [bodyOptions]);

  useEffect(() => {
    setApplicationId(engineOptions.length === 1 ? engineOptions[0].id : "");
  }, [engineOptions]);

  const selectedMake = useMemo(() => makes.find((entry) => entry.id === makeId)?.name ?? "", [makeId, makes]);
  const selectedModel = useMemo(() => models.find((entry) => entry.id === modelId)?.name ?? "", [modelId, models]);
  const selectedApplication = useMemo(() => applications.find((entry) => entry.id === applicationId) ?? null, [applicationId, applications]);
  const selectedChassis = selectedApplication?.chassisCodes.join(" / ") || selectedApplication?.generationName || "";
  const vehicleReady = Boolean(makeId && modelId && year && selectedApplication);
  const partsHref = useMemo(
    () => buildVehiclePartsHref(getSelectedVehicleContext(), category),
    [applicationId, category, makeId, modelId, selectedApplication, selectedChassis, selectedMake, selectedModel, year]
  );

  useEffect(() => {
    if (partsHref) router.prefetch(partsHref as never);
  }, [partsHref, router]);

  function findParts() {
    const context = getSelectedVehicleContext();
    if (!context) return;
    saveVehicleContext(context);
    startTransition(() => router.push(partsHref as never));
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
    <section className={`${compact ? "rounded-xl p-3 sm:p-4" : "rounded-2xl p-4 sm:p-5"} border border-black/10 bg-white text-ink shadow-panel`}>
      <div>
        <div className={`flex gap-2 ${compact ? "items-center justify-between" : "flex-col sm:flex-row sm:items-end sm:justify-between"}`}>
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-signal">
              <CarFront className="h-4 w-4" /> My Vehicle
            </div>
            <h2 className={`${compact ? "mt-0.5 text-base" : "mt-1 text-xl"} font-black leading-tight`}>Find compatible parts</h2>
            {!compact ? <p className="mt-1 text-[11px] font-bold text-steel">New NexAuto vehicle catalogue</p> : null}
          </div>
          <p className={`${compact ? "max-w-[230px] text-right text-[10px] leading-4" : "text-xs"} font-bold text-steel`}>Make → Model → Year → Chassis → Body / drivetrain → Engine</p>
        </div>

        <div className={`${compact ? "mt-3 grid-cols-2 gap-2 sm:grid-cols-3" : "mt-4 grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-6"} grid`}>
        <SelectControl compact={compact} label="Make" value={makeId} disabled={loading === "makes"} onChange={setMakeId}>
          <option value="">Select make</option>
          {makes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </SelectControl>
        <SelectControl compact={compact} label="Model" value={modelId} disabled={!makeId || loading === "models"} onChange={setModelId}>
          <option value="">Select model</option>
          {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </SelectControl>
        <SelectControl compact={compact} label="Year" value={year} disabled={!modelId || loading === "years"} onChange={setYear}>
          <option value="">Select year</option>
          {years.map((entry) => <option key={entry} value={String(entry)}>{entry}</option>)}
        </SelectControl>
        <SelectControl compact={compact} label="Chassis / code" value={generationId} disabled={!year || loading === "applications" || chassisOptions.length === 0} onChange={setGenerationId}>
          <option value="">Select chassis</option>
          {chassisOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </SelectControl>
        <SelectControl compact={compact} label="Body / drivetrain" value={bodyConfiguration} disabled={!generationId || bodyOptions.length === 0} onChange={setBodyConfiguration}>
          <option value="">Select body / drivetrain</option>
          {bodyOptions.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </SelectControl>
        <SelectControl compact={compact} label="Engine" value={applicationId} disabled={!bodyConfiguration || engineOptions.length === 0} onChange={setApplicationId}>
          <option value="">Select engine</option>
          {engineOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.engine}</option>)}
        </SelectControl>
        </div>

        <button type="button" disabled={!vehicleReady || Boolean(loading)} onClick={findParts} className={`${compact ? "mt-3 h-10" : "mt-4 h-12 sm:w-auto sm:min-w-[210px]"} inline-flex w-full items-center justify-center gap-2 rounded-lg bg-signal px-5 text-sm font-black text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300`}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {compact ? "Show Compatible Parts" : "Find Compatible Parts"}
        </button>
      </div>

      {error ? <div className={`${compact ? "mt-2 p-2 text-xs" : "mt-4 p-3 text-sm"} rounded-lg border border-signal/25 bg-red-50 font-bold text-signal`}>{error}</div> : null}
    </section>
  );
}

function SelectControl({ compact = false, label, value, disabled, onChange, children }: { compact?: boolean; label: string; value: string; disabled: boolean; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={compact ? "sr-only" : "text-xs font-black uppercase tracking-[0.13em] text-steel"}>{label}</span>
      <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${compact ? "h-10 text-xs" : "mt-2 h-12 text-base sm:text-sm"} w-full rounded-lg border border-black/10 bg-white px-3 font-bold outline-none disabled:bg-zinc-100 disabled:text-steel`}>
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

function fetchJsonCached<T>(url: string): Promise<T> {
  const cached = vehicleRequestCache.get(url) as Promise<T> | undefined;
  if (cached) return cached;

  const request = fetchJson<T>(url).catch((error) => {
    vehicleRequestCache.delete(url);
    throw error;
  });
  vehicleRequestCache.set(url, request);
  return request;
}

export function buildVehiclePartsHref(context: VehicleContext | null, category?: string) {
  if (!context) return "";
  const query = new URLSearchParams({
    makeId: context.makeId,
    modelId: context.modelId,
    year: context.year,
    make: context.make,
    model: context.model,
    applicationId: context.applicationId ?? "",
    generationId: context.generationId ?? "",
    variantId: context.variantId ?? "",
    chassis: context.chassis ?? "",
    body: context.bodyConfiguration ?? "",
    engine: context.engine ?? ""
  });
  if (category && category !== "all") query.set("category", category);
  return `/parts?${query}`;
}
