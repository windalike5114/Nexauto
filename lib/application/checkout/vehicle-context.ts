import { z } from "zod";
import { isLooseUuid, looseUuidPattern } from "@/lib/domain/shared/uuid";

export const LooseUuidSchema = z
  .string()
  .trim()
  .regex(looseUuidPattern, "Invalid UUID.");

export type NormalizedVehicleContext = {
  applicationId: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  series: string | null;
  body: string | null;
  label: string | null;
  driverSize: string | null;
  passengerSize: string | null;
  rearSize: string | null;
  adapterCode: string | null;
  wiperSetId: string | null;
};

export function normalizeVehicleContext(input: Record<string, unknown> | null | undefined): NormalizedVehicleContext | null {
  if (!input) return null;

  const applicationId = normalizeOptionalUuid(input.applicationId ?? input.vehicle_application_id);
  const make = cleanString(input.make ?? input.vehicle_make);
  const model = cleanString(input.model ?? input.vehicle_model);
  const year = normalizeYear(input.year ?? input.vehicle_year);
  const series = cleanString(input.series ?? input.generation);
  const body = cleanString(input.body ?? input.variant);
  const label = cleanString(input.label ?? input.vehicle);
  const driverSize = normalizeLengthLabel(input.driverSize ?? input.driver_length);
  const passengerSize = normalizeLengthLabel(input.passengerSize ?? input.passenger_length);
  const rearSize = normalizeLengthLabel(input.rearSize ?? input.rear_length);
  const adapterCode = normalizeAdapterCode(input.adapterCode ?? input.connector_code ?? input.connector);
  const wiperSetId = normalizeOptionalUuid(input.wiperSetId ?? input.wiper_set_id);
  const hasAny = Boolean(applicationId || make || model || year || series || body || label || driverSize || passengerSize || rearSize || adapterCode || wiperSetId);

  if (!hasAny) return null;

  return {
    applicationId,
    make,
    model,
    year,
    series,
    body,
    label,
    driverSize,
    passengerSize,
    rearSize,
    adapterCode,
    wiperSetId
  };
}

export function toLegacyVehicleSnapshot(vehicle: NormalizedVehicleContext | null) {
  if (!vehicle?.make || !vehicle.model || !vehicle.year) return null;

  return {
    a: vehicle.applicationId,
    m: vehicle.make,
    d: vehicle.model,
    y: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    series: vehicle.series ?? "",
    body: vehicle.body ?? ""
  };
}

function normalizeOptionalUuid(value: unknown) {
  const stringValue = cleanString(value);
  if (!stringValue) return null;
  return isLooseUuid(stringValue) ? stringValue : null;
}

function cleanString(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const stringValue = String(value).trim();
  return stringValue ? stringValue : null;
}

function normalizeYear(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
  return year;
}

function normalizeLengthLabel(value: unknown) {
  const stringValue = cleanString(value);
  if (!stringValue) return null;
  const parsed = Number(stringValue.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number.isInteger(parsed) ? `${parsed}"` : `${parsed}"`;
}

function normalizeAdapterCode(value: unknown) {
  const stringValue = cleanString(value);
  return stringValue ? stringValue.replace(/\s+/g, "-").toUpperCase() : null;
}
