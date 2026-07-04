"use client";

import Link from "next/link";
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
};

export function WiperFitmentFinder({ compact = false }: { compact?: boolean }) {
  const [makes, setMakes] = useState<FinderOption[]>([]);
  const [models, setModels] = useState<FinderOption[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [year, setYear] = useState("");
  const [fitments, setFitments] = useState<FitmentResult[]>([]);
  const [loading, setLoading] = useState("makes");
  const [error, setError] = useState("");

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
  }, [makeId, modelId, year]);

  const selectedMake = useMemo(() => makes.find((entry) => entry.id === makeId)?.name ?? "", [makeId, makes]);
  const selectedModel = useMemo(() => models.find((entry) => entry.id === modelId)?.name ?? "", [modelId, models]);
  const busy = Boolean(loading);

  return (
    <section className={`rounded-lg border border-black/10 bg-white shadow-sm ${compact ? "p-5" : "p-6 sm:p-7"}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
        <div className="hidden h-12 w-12 shrink-0 place-items-center rounded bg-ink text-white sm:grid">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
        </div>
      </div>

      <div className={`mt-5 grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-3"}`}>
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

      {error ? <div className="mt-4 rounded border border-signal/30 bg-red-50 p-3 text-sm font-bold text-signal">{error}</div> : null}

      {year && !busy && !error ? (
        <div className="mt-5">
          {fitments.length ? (
            <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="rounded border border-black/10 bg-zinc-50 p-4">
                <p className="text-sm font-black">
                  {selectedMake} {selectedModel} {year}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <LengthPill label="Driver" value={fitments[0].driverLengthIn} />
                  <LengthPill label="Passenger" value={fitments[0].passengerLengthIn} />
                  <LengthPill label="Rear" value={fitments[0].rearLengthIn} />
                </div>
                <p className="mt-3 text-xs font-bold text-steel">
                  Fitment range: {fitments[0].startRaw ?? "?"} - {fitments[0].endRaw ?? "?"}. Connector type is checked separately.
                </p>
              </div>
              <Link
                href="/products/universal-wiper-blade"
                className="inline-flex h-12 items-center justify-center gap-2 rounded bg-signal px-5 text-sm font-black text-white hover:bg-red-700"
              >
                Choose wipers
                <ArrowRight className="h-4 w-4" />
              </Link>
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "Fitment request failed.");
  }

  return data as T;
}
