"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CarFront, Loader2, Search } from "lucide-react";
import { saveVehicleContext, type VehicleContext } from "@/lib/vehicle-context";

type FinderOption = { id: string; name: string };
type FinderModelOption = FinderOption & { years: number[] };
type FinderMakeOption = FinderOption & { models: FinderModelOption[] };
type VehicleApplicationOption = {
  id: string; seriesId: string | null; seriesName: string; powertrainId: string; engine: string;
  variantId: string; variantName: string; bodyStyle: string; driveType: string; vehicleClass: string;
};

const catalogVersion = "v5";
const noSeriesKey = "__no_series__";
const requestCache = new Map<string, Promise<unknown>>();

export function VehiclePartsFinder({ compact = false, category }: { compact?: boolean; category?: string } = {}) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<FinderMakeOption[]>([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [year, setYear] = useState("");
  const [applications, setApplications] = useState<VehicleApplicationOption[]>([]);
  const [seriesKey, setSeriesKey] = useState("");
  const [powertrainId, setPowertrainId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [loading, setLoading] = useState("catalog");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchJsonCached<{ makes: FinderMakeOption[] }>(`/api/vehicles/catalog?catalog=${catalogVersion}`)
      .then((data) => { if (active) setCatalog(data.makes); })
      .catch((nextError) => { if (active) setError(nextError.message); })
      .finally(() => { if (active) setLoading(""); });
    return () => { active = false; };
  }, []);

  const makes = useMemo(() => catalog.map(({ id, name }) => ({ id, name })), [catalog]);
  const models = useMemo(() => catalog.find((make) => make.id === makeId)?.models ?? [], [catalog, makeId]);
  const years = useMemo(() => models.find((model) => model.id === modelId)?.years ?? [], [modelId, models]);

  useEffect(() => { setModelId(""); setYear(""); resetDetails(); }, [makeId]);
  useEffect(() => { setYear(""); resetDetails(); }, [modelId]);
  useEffect(() => {
    if (!makeId || !modelId || !year) { resetDetails(); return; }
    let active = true;
    setLoading("applications"); setError(""); resetDetails();
    fetchJsonCached<{ applications: VehicleApplicationOption[] }>(`/api/vehicles/applications?makeId=${makeId}&modelId=${modelId}&year=${year}&catalog=${catalogVersion}`)
      .then((data) => {
        if (!active) return;
        setApplications(data.applications);
        if (data.applications.length === 0) setError("No vehicle configuration was found for this year.");
      })
      .catch((nextError) => { if (active) setError(nextError.message); })
      .finally(() => { if (active) setLoading(""); });
    return () => { active = false; };
  }, [makeId, modelId, year]);

  const seriesOptions = useMemo(() => uniqueOptions(applications.map((app) => ({ id: app.seriesId ?? noSeriesKey, name: app.seriesName || "Series not specified" }))), [applications]);
  const showSeries = seriesOptions.some((option) => option.id !== noSeriesKey);
  useEffect(() => {
    setPowertrainId(""); setVariantId("");
    setSeriesKey(seriesOptions.length === 1 ? seriesOptions[0].id : "");
  }, [seriesOptions]);

  const seriesCandidates = useMemo(() => applications.filter((app) => !showSeries || (app.seriesId ?? noSeriesKey) === seriesKey), [applications, seriesKey, showSeries]);
  const engineOptions = useMemo(() => uniqueOptions(seriesCandidates.map((app) => ({ id: app.powertrainId, name: app.engine }))), [seriesCandidates]);
  useEffect(() => {
    setVariantId("");
    setPowertrainId(engineOptions.length === 1 ? engineOptions[0].id : "");
  }, [engineOptions]);

  const engineCandidates = useMemo(() => seriesCandidates.filter((app) => app.powertrainId === powertrainId), [powertrainId, seriesCandidates]);
  const variantOptions = useMemo(() => uniqueOptions(engineCandidates.map((app) => ({ id: app.variantId, name: variantLabel(app) }))), [engineCandidates]);
  useEffect(() => setVariantId(variantOptions.length === 1 ? variantOptions[0].id : ""), [variantOptions]);

  const selectedApplications = useMemo(() => engineCandidates.filter((app) => app.variantId === variantId), [engineCandidates, variantId]);
  const selectedApplication = selectedApplications[0] ?? null;
  const selectedMake = makes.find((entry) => entry.id === makeId)?.name ?? "";
  const selectedModel = models.find((entry) => entry.id === modelId)?.name ?? "";
  const context = selectedApplication ? getContext() : null;
  const partsHref = buildVehiclePartsHref(context, category);

  useEffect(() => { if (partsHref) router.prefetch(partsHref as never); }, [partsHref, router]);

  function resetDetails() { setApplications([]); setSeriesKey(""); setPowertrainId(""); setVariantId(""); }
  function getContext(): VehicleContext | null {
    if (!selectedApplication) return null;
    return {
      makeId, modelId, year, make: selectedMake, model: selectedModel,
      applicationId: selectedApplication.id,
      applicationIds: selectedApplications.map((app) => app.id),
      generationId: selectedApplication.seriesId ?? undefined,
      variantId: selectedApplication.variantId,
      chassis: selectedApplication.seriesName || undefined,
      bodyConfiguration: variantLabel(selectedApplication), engine: selectedApplication.engine
    };
  }
  function findParts() {
    if (!context) return;
    saveVehicleContext(context);
    startTransition(() => router.push(partsHref as never));
  }

  return (
    <section className={`${compact ? "rounded-xl p-3 sm:p-4" : "rounded-2xl p-4 sm:p-5"} border border-black/10 bg-white text-ink shadow-panel`}>
      <div className={`flex gap-2 ${compact ? "items-center justify-between" : "flex-col sm:flex-row sm:items-end sm:justify-between"}`}>
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-signal"><CarFront className="h-4 w-4" /> My Vehicle</div>
          <h2 className={`${compact ? "mt-0.5 text-base" : "mt-1 text-xl"} font-black leading-tight`}>Find compatible parts</h2>
        </div>
        <p className={`${compact ? "max-w-[230px] text-right text-[10px] leading-4" : "text-xs"} font-bold text-steel`}>Make → Model → Year → Series → Engine → Variant</p>
      </div>

      <div className={`${compact ? "mt-3 grid-cols-2 gap-2 sm:grid-cols-3" : "mt-4 grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-6"} grid`}>
        <SelectControl compact={compact} label="Make" value={makeId} disabled={loading === "catalog"} onChange={setMakeId} placeholder="Select make" options={makes} />
        <SelectControl compact={compact} label="Model" value={modelId} disabled={!makeId} onChange={setModelId} placeholder="Select model" options={models} />
        <SelectControl compact={compact} label="Year" value={year} disabled={!modelId} onChange={setYear} placeholder="Select year" options={years.map((item) => ({ id: String(item), name: String(item) }))} />
        {showSeries ? <SelectControl compact={compact} label="Series" value={seriesKey} disabled={!year || loading === "applications"} onChange={setSeriesKey} placeholder="Select series" options={seriesOptions} /> : null}
        <SelectControl compact={compact} label="Engine" value={powertrainId} disabled={!year || (showSeries && !seriesKey)} onChange={setPowertrainId} placeholder="Select engine" options={engineOptions} />
        <SelectControl compact={compact} label="Variant" value={variantId} disabled={!powertrainId} onChange={setVariantId} placeholder="Select variant" options={variantOptions} />
      </div>

      <button type="button" disabled={!context || Boolean(loading)} onClick={findParts} className={`${compact ? "mt-3 h-10" : "mt-4 h-12 sm:w-auto sm:min-w-[210px]"} inline-flex w-full items-center justify-center gap-2 rounded-lg bg-signal px-5 text-sm font-black text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300`}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        {compact ? "Show Compatible Parts" : "Find Compatible Parts"}
      </button>
      {error ? <div className={`${compact ? "mt-2 p-2 text-xs" : "mt-4 p-3 text-sm"} rounded-lg border border-signal/25 bg-red-50 font-bold text-signal`}>{error}</div> : null}
    </section>
  );
}

function SelectControl({ compact = false, label, value, disabled, onChange, placeholder, options }: {
  compact?: boolean; label: string; value: string; disabled: boolean; onChange: (value: string) => void;
  placeholder: string; options: FinderOption[];
}) {
  return <label className="block">
    <span className={compact ? "sr-only" : "text-xs font-black uppercase tracking-[0.13em] text-steel"}>{label}</span>
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${compact ? "h-10 text-xs" : "mt-2 h-12 text-base sm:text-sm"} w-full rounded-lg border border-black/10 bg-white px-3 font-bold outline-none disabled:bg-zinc-100 disabled:text-steel`}>
      <option value="">{placeholder}</option>
      {options.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </select>
  </label>;
}
function uniqueOptions(options: FinderOption[]) {
  return [...new Map(options.map((option) => [option.id, option])).values()].sort((a, b) => a.name.localeCompare(b.name));
}
function variantLabel(app: VehicleApplicationOption) {
  return [app.variantName, app.driveType && !app.variantName.toLowerCase().includes(app.driveType.toLowerCase()) ? app.driveType : ""].filter(Boolean).join(" · ");
}
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url); const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Vehicle request failed.");
  return data as T;
}
function fetchJsonCached<T>(url: string): Promise<T> {
  const cached = requestCache.get(url) as Promise<T> | undefined;
  if (cached) return cached;
  const request = fetchJson<T>(url).catch((error) => { requestCache.delete(url); throw error; });
  requestCache.set(url, request); return request;
}
export function buildVehiclePartsHref(context: VehicleContext | null, category?: string) {
  if (!context) return "";
  const query = new URLSearchParams({
    makeId: context.makeId, modelId: context.modelId, year: context.year, make: context.make, model: context.model,
    applicationId: context.applicationId ?? "", applicationIds: (context.applicationIds ?? []).join(","),
    generationId: context.generationId ?? "", variantId: context.variantId ?? "", chassis: context.chassis ?? "",
    body: context.bodyConfiguration ?? "", engine: context.engine ?? ""
  });
  if (category && category !== "all") query.set("category", category);
  return `/parts?${query}`;
}
