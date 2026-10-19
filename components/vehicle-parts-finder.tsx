"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CarFront, Loader2, Search } from "lucide-react";
import { saveVehicleContext, type VehicleContext } from "@/lib/vehicle-context";

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
const vehicleRequestCache = new Map<string, Promise<unknown>>();

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
  const [loading, setLoading] = useState("makes");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchJsonCached<{ makes: FinderOption[] }>(`/api/vehicles/makes?catalog=${vehicleCatalogApiVersion}`)
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
      resetApplicationSelection();
      return;
    }

    let active = true;
    setLoading("models");
    setError("");
    setModelId("");
    setYears([]);
    setYear("");
    resetApplicationSelection();
    fetchJsonCached<{ models: FinderOption[] }>(`/api/vehicles/models?makeId=${makeId}&catalog=${vehicleCatalogApiVersion}`)
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
    setError("");
    setYear("");
    resetApplicationSelection();
    fetchJsonCached<{ years: number[] }>(`/api/vehicles/years?makeId=${makeId}&modelId=${modelId}&catalog=${vehicleCatalogApiVersion}`)
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
  const partsHref = useMemo(() => buildPartsHref(getSelectedVehicleContext()), [applicationId, makeId, modelId, selectedApplication, selectedChassis, selectedMake, selectedModel, year]);

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
    <section className="rounded-2xl border border-black/10 bg-white p-4 text-ink shadow-panel sm:p-5">
      <div>
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

        <button type="button" disabled={!vehicleReady || Boolean(loading)} onClick={findParts} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-signal px-5 text-sm font-black text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300 sm:w-auto sm:min-w-[210px]">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Find Compatible Parts
        </button>
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

function buildPartsHref(context: VehicleContext | null) {
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
  return `/parts?${query}`;
}
