import { createSupabaseServerClient } from "@/lib/supabase";

export type WiperFitmentMake = { id: string; name: string };
export type WiperFitmentModel = { id: string; name: string };
export type WiperFitmentApplicationKind = "legacy" | "canonical";

export type WiperFitmentVariant = {
  id: string;
  key: string;
  name: string;
  applicationKind: WiperFitmentApplicationKind;
};

export type WiperFitmentResult = {
  applicationId: string;
  applicationKind: WiperFitmentApplicationKind;
  make: string;
  model: string;
  generationName: string | null;
  variantName: string | null;
  bodyStyle: string | null;
  startRaw: string | null;
  endRaw: string | null;
  driverLengthIn: number | null;
  passengerLengthIn: number | null;
  rearLengthIn: number | null;
};

const PRIORITY_NZ_MAKES = ["Toyota", "Ford", "Mazda", "Nissan", "Mitsubishi", "Honda", "Subaru", "Hyundai", "Kia", "Suzuki"];

const CANONICAL_FITMENT_SELECT = `
  id,
  fitment_status,
  vehicle_fitment_applications!inner(
    id,
    year_start,
    year_end,
    fitment_status,
    active,
    vehicle_variants(id,name,body_style),
    vehicle_generations!inner(
      id,
      name,
      active,
      vehicle_models!inner(
        id,
        name,
        make_id,
        vehicle_makes!inner(id,name)
      )
    )
  ),
  wiper_configurations!inner(
    id,
    configuration_status,
    rear_status,
    wiper_configuration_blades(position,length_in)
  )
`;

type ApplicationMakeRow = {
  vehicle_applications: { vehicle_makes: WiperFitmentMake | WiperFitmentMake[] | null } | null;
};

type ApplicationModelRow = {
  model_id: string;
  vehicle_models: WiperFitmentModel | WiperFitmentModel[] | null;
};

type ApplicationYearRow = { year_start: number | null; year_end: number | null };

type ApplicationFitmentRow = {
  id: string;
  start_raw: string | null;
  end_raw: string | null;
  year_start: number | null;
  year_end: number | null;
  vehicle_makes: { name: string } | Array<{ name: string }> | null;
  vehicle_models: { name: string } | Array<{ name: string }> | null;
  wiper_length_fitments: Array<{
    driver_length_in: string | number | null;
    passenger_length_in: string | number | null;
    rear_length_in: string | number | null;
  }> | null;
};

type CanonicalModel = {
  id: string;
  name: string;
  make_id: string;
  vehicle_makes: WiperFitmentMake | WiperFitmentMake[] | null;
};

type CanonicalGeneration = {
  id: string;
  name: string;
  active: boolean;
  vehicle_models: CanonicalModel | CanonicalModel[] | null;
};

type CanonicalVariant = { id: string; name: string; body_style: string };
type CanonicalConfiguration = {
  id: string;
  configuration_status: string;
  rear_status: string;
  wiper_configuration_blades: Array<{ position: string; length_in: string | number }>;
};

export type CanonicalFitmentRow = {
  id: string;
  fitment_status: string;
  vehicle_fitment_applications: {
    id: string;
    year_start: number | null;
    year_end: number | null;
    fitment_status: string;
    active: boolean;
    vehicle_variants: CanonicalVariant | CanonicalVariant[] | null;
    vehicle_generations: CanonicalGeneration | CanonicalGeneration[] | null;
  } | Array<{
    id: string;
    year_start: number | null;
    year_end: number | null;
    fitment_status: string;
    active: boolean;
    vehicle_variants: CanonicalVariant | CanonicalVariant[] | null;
    vehicle_generations: CanonicalGeneration | CanonicalGeneration[] | null;
  }> | null;
  wiper_configurations: CanonicalConfiguration | CanonicalConfiguration[] | null;
};

function getSupabaseOrThrow() {
  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured for fitment lookup.");
  return supabase;
}

function single<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function listWiperFitmentMakes() {
  const supabase = getSupabaseOrThrow();
  const [legacy, canonical] = await Promise.all([
    selectAll(
      supabase.from("wiper_length_fitments").select("vehicle_applications(vehicle_makes(id,name))").order("created_at", { ascending: true })
    ),
    loadPublishedCanonicalFitments(supabase)
  ]);
  if (legacy.error) throw legacy.error;
  if (canonical.error) throw canonical.error;

  const makes = new Map<string, WiperFitmentMake>();
  for (const row of (legacy.data ?? []) as unknown as ApplicationMakeRow[]) {
    const make = single(row.vehicle_applications?.vehicle_makes);
    if (make?.id) makes.set(make.id, { id: make.id, name: make.name });
  }
  for (const row of canonical.data) {
    const identity = getCanonicalIdentity(row);
    if (identity) makes.set(identity.make.id, identity.make);
  }
  return sortMakesForNzFinder([...makes.values()]);
}

export async function listWiperFitmentModels(makeId: string) {
  const supabase = getSupabaseOrThrow();
  const [legacy, canonical] = await Promise.all([
    supabase.from("vehicle_applications").select("model_id,vehicle_models(id,name)").eq("make_id", makeId).eq("active", true).order("model_id"),
    loadPublishedCanonicalFitments(supabase)
  ]);
  if (legacy.error) throw legacy.error;
  if (canonical.error) throw canonical.error;

  const models = new Map<string, WiperFitmentModel>();
  for (const row of (legacy.data ?? []) as unknown as ApplicationModelRow[]) {
    const model = single(row.vehicle_models);
    if (model?.id) models.set(model.id, { id: model.id, name: model.name });
  }
  for (const row of canonical.data) {
    const identity = getCanonicalIdentity(row);
    if (identity?.make.id === makeId) models.set(identity.model.id, identity.model);
  }
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listWiperFitmentYears(makeId: string, modelId: string) {
  const supabase = getSupabaseOrThrow();
  const [legacy, canonical] = await Promise.all([
    supabase.from("vehicle_applications").select("year_start,year_end").eq("make_id", makeId).eq("model_id", modelId).eq("active", true),
    loadPublishedCanonicalFitments(supabase)
  ]);
  if (legacy.error) throw legacy.error;
  if (canonical.error) throw canonical.error;

  const years = new Set<number>();
  for (const row of (legacy.data ?? []) as ApplicationYearRow[]) addYears(years, row.year_start, row.year_end, false);
  for (const row of canonical.data) {
    const identity = getCanonicalIdentity(row);
    if (identity?.make.id === makeId && identity.model.id === modelId) {
      addYears(years, identity.application.year_start, identity.application.year_end, true);
    }
  }
  return [...years].sort((a, b) => b - a);
}

export async function listWiperFitmentVariants(makeId: string, modelId: string, year: number) {
  const results = await findWiperLengthFitments(makeId, modelId, year);
  return results.map((fitment): WiperFitmentVariant => ({
    id: fitment.applicationId,
    key: `${fitment.applicationKind}:${fitment.applicationId}`,
    name: getVariantLabel(fitment),
    applicationKind: fitment.applicationKind
  }));
}

export async function findWiperLengthFitments(
  makeId: string,
  modelId: string,
  year: number,
  selection?: { applicationId: string; applicationKind: WiperFitmentApplicationKind }
) {
  const supabase = getSupabaseOrThrow();
  const [legacy, canonical] = await Promise.all([
    supabase
      .from("vehicle_applications")
      .select(`id,start_raw,end_raw,year_start,year_end,vehicle_makes(name),vehicle_models(name),wiper_length_fitments(driver_length_in,passenger_length_in,rear_length_in)`)
      .eq("make_id", makeId)
      .eq("model_id", modelId)
      .lte("year_start", year)
      .gte("year_end", year)
      .eq("active", true)
      .order("year_start", { ascending: false }),
    loadPublishedCanonicalFitments(supabase)
  ]);
  if (legacy.error) throw legacy.error;
  if (canonical.error) throw canonical.error;

  const legacyResults = ((legacy.data ?? []) as unknown as ApplicationFitmentRow[])
    .map(mapLegacyFitmentRow)
    .filter((entry): entry is WiperFitmentResult => Boolean(entry));
  const canonicalResults = canonical.data
    .filter((row) => canonicalFitsVehicle(row, makeId, modelId, year))
    .map(mapCanonicalFitmentRow)
    .filter((entry): entry is WiperFitmentResult => Boolean(entry));

  return [...legacyResults, ...canonicalResults]
    .filter((entry) => !selection || (entry.applicationId === selection.applicationId && entry.applicationKind === selection.applicationKind))
    .sort(compareFitments);
}

function mapLegacyFitmentRow(row: ApplicationFitmentRow): WiperFitmentResult | null {
  const fitment = row.wiper_length_fitments?.[0];
  if (!fitment) return null;
  return {
    applicationId: row.id,
    applicationKind: "legacy",
    make: single(row.vehicle_makes)?.name ?? "",
    model: single(row.vehicle_models)?.name ?? "",
    generationName: null,
    variantName: null,
    bodyStyle: null,
    startRaw: row.start_raw,
    endRaw: row.end_raw,
    driverLengthIn: toNumber(fitment.driver_length_in),
    passengerLengthIn: toNumber(fitment.passenger_length_in),
    rearLengthIn: toNumber(fitment.rear_length_in)
  };
}

export function mapCanonicalFitmentRow(row: CanonicalFitmentRow): WiperFitmentResult | null {
  const identity = getCanonicalIdentity(row);
  const configuration = single(row.wiper_configurations);
  if (!identity || !configuration) return null;
  const variant = single(identity.application.vehicle_variants);
  const blades = new Map(configuration.wiper_configuration_blades.map((blade) => [blade.position, toNumber(blade.length_in)]));
  return {
    applicationId: identity.application.id,
    applicationKind: "canonical",
    make: identity.make.name,
    model: identity.model.name,
    generationName: identity.generation.name,
    variantName: variant?.name ?? null,
    bodyStyle: variant?.body_style ?? null,
    startRaw: identity.application.year_start ? String(identity.application.year_start) : null,
    endRaw: identity.application.year_end ? String(identity.application.year_end) : "ON",
    driverLengthIn: blades.get("driver") ?? null,
    passengerLengthIn: blades.get("passenger") ?? null,
    rearLengthIn: blades.get("rear") ?? null
  };
}

function getCanonicalIdentity(row: CanonicalFitmentRow) {
  const application = single(row.vehicle_fitment_applications);
  const generation = single(application?.vehicle_generations);
  const model = single(generation?.vehicle_models);
  const make = single(model?.vehicle_makes);
  if (!application || !generation || !model || !make) return null;
  return {
    application,
    generation,
    model: { id: model.id, name: model.name },
    make: { id: make.id, name: make.name }
  };
}

function canonicalFitsVehicle(row: CanonicalFitmentRow, makeId: string, modelId: string, year: number) {
  const identity = getCanonicalIdentity(row);
  if (!identity || identity.make.id !== makeId || identity.model.id !== modelId) return false;
  const { year_start: start, year_end: end } = identity.application;
  return (!start || start <= year) && (!end || end >= year);
}

async function loadPublishedCanonicalFitments(supabase: ReturnType<typeof getSupabaseOrThrow>) {
  const result = await selectAll(
    supabase
      .from("vehicle_wiper_fitments")
      .select(CANONICAL_FITMENT_SELECT)
      .eq("fitment_status", "published")
      .eq("vehicle_fitment_applications.fitment_status", "published")
      .eq("vehicle_fitment_applications.active", true)
      .eq("vehicle_fitment_applications.vehicle_generations.active", true)
      .eq("wiper_configurations.configuration_status", "published")
  );
  return { data: (result.data ?? []) as unknown as CanonicalFitmentRow[], error: result.error };
}

function addYears(years: Set<number>, start: number | null, end: number | null, allowOpenEnded: boolean) {
  if (!start) return;
  const finalYear = end ?? (allowOpenEnded ? new Date().getFullYear() : null);
  if (!finalYear) return;
  for (let year = start; year <= finalYear; year += 1) years.add(year);
}

function getVariantLabel(fitment: WiperFitmentResult) {
  if (fitment.applicationKind === "legacy") return `Standard · ${fitment.startRaw ?? "?"}-${fitment.endRaw ?? "?"}`;
  const parts = [fitment.generationName, fitment.variantName, formatBodyStyle(fitment.bodyStyle)].filter(Boolean);
  return parts.length ? parts.join(" · ") : `${fitment.startRaw ?? "?"}-${fitment.endRaw ?? "ON"}`;
}

function formatBodyStyle(value: string | null) {
  if (!value || value === "unknown") return null;
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function compareFitments(left: WiperFitmentResult, right: WiperFitmentResult) {
  if (left.applicationKind !== right.applicationKind) return left.applicationKind === "canonical" ? -1 : 1;
  return getVariantLabel(left).localeCompare(getVariantLabel(right));
}

function toNumber(value: string | number | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sortMakesForNzFinder(makes: WiperFitmentMake[]) {
  const priority = new Map(PRIORITY_NZ_MAKES.map((name, index) => [name.toLowerCase(), index]));
  return [...makes].sort((left, right) => {
    const leftPriority = priority.get(left.name.toLowerCase());
    const rightPriority = priority.get(right.name.toLowerCase());
    if (leftPriority !== undefined || rightPriority !== undefined) {
      return (leftPriority ?? Number.MAX_SAFE_INTEGER) - (rightPriority ?? Number.MAX_SAFE_INTEGER);
    }
    return left.name.localeCompare(right.name);
  });
}

async function selectAll<T>(query: { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> }, size = 1000) {
  const data: T[] = [];
  for (let from = 0; ; from += size) {
    const result = await query.range(from, from + size - 1);
    if (result.error) return { data, error: result.error };
    data.push(...(result.data ?? []));
    if (!result.data || result.data.length < size) return { data, error: null };
  }
}
