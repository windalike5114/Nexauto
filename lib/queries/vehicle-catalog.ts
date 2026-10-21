import { unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase";

export type VehicleCatalogOption = { id: string; name: string };
export type VehicleCatalogIndexModel = VehicleCatalogOption & { years: number[] };
export type VehicleCatalogIndexMake = VehicleCatalogOption & { models: VehicleCatalogIndexModel[] };

export type VehicleCatalogApplicationOption = {
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

export const VEHICLE_CATALOG_SOURCE_PATTERN = "NEXAUTO_V4:%";

type VehicleMake = VehicleCatalogOption;
type VehicleModel = VehicleCatalogOption & {
  make_id: string;
  vehicle_makes: VehicleMake | VehicleMake[] | null;
};
type VehicleGeneration = VehicleCatalogOption & {
  active: boolean;
  vehicle_models: VehicleModel | VehicleModel[] | null;
  vehicle_chassis_assignments: Array<{
    variant_id: string | null;
    is_primary: boolean;
    vehicle_chassis_codes: { code: string } | Array<{ code: string }> | null;
  }>;
};

type VehicleVariant = VehicleCatalogOption & {
  body_style: string;
  engine_code: string | null;
  active: boolean;
};

type VehicleApplicationRow = {
  id: string;
  variant_id: string | null;
  year_start: number | null;
  year_end: number | null;
  vehicle_generations: VehicleGeneration | VehicleGeneration[] | null;
  vehicle_variants: VehicleVariant | VehicleVariant[] | null;
};

const PRIORITY_NZ_MAKES = ["Toyota", "Ford", "Mazda", "Nissan", "Mitsubishi", "Honda", "Subaru", "Hyundai", "Kia", "Suzuki"];

const VEHICLE_APPLICATION_SELECT = `
  id,
  variant_id,
  year_start,
  year_end,
  vehicle_variants!inner(
    id,
    name,
    body_style,
    engine_code,
    active
  ),
  vehicle_generations!inner(
    id,
    name,
    active,
    vehicle_chassis_assignments(
      variant_id,
      is_primary,
      vehicle_chassis_codes(code)
    ),
    vehicle_models!inner(
      id,
      name,
      make_id,
      vehicle_makes!inner(id,name)
    )
  )
`;

const VEHICLE_IDENTITY_SELECT = `
  id,
  year_start,
  year_end,
  vehicle_generations!inner(
    id,
    active,
    vehicle_models!inner(
      id,
      name,
      make_id,
      vehicle_makes!inner(id,name)
    )
  )
`;

function getSupabaseOrThrow() {
  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured for vehicle lookup.");
  return supabase;
}

function single<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function getIdentity(row: VehicleApplicationRow) {
  const generation = single(row.vehicle_generations);
  const model = single(generation?.vehicle_models);
  const make = single(model?.vehicle_makes);
  if (!generation || !model || !make) return null;
  return { application: row, generation, model, make };
}

export const listVehicleCatalogMakes = unstable_cache(async () => {
  const rows = await loadPublishedVehicleIdentities();
  const makes = new Map<string, VehicleCatalogOption>();
  for (const row of rows) {
    const identity = getIdentity(row);
    if (identity) makes.set(identity.make.id, { id: identity.make.id, name: identity.make.name });
  }
  return sortMakesForNz([...makes.values()]);
}, ["vehicle-catalog-v4-makes"], { revalidate: 3600, tags: ["vehicle-catalog-v4"] });

export const listVehicleCatalogIndex = unstable_cache(async (): Promise<VehicleCatalogIndexMake[]> => {
  const rows = await loadPublishedVehicleIdentities();
  const makes = new Map<string, { option: VehicleCatalogOption; models: Map<string, { option: VehicleCatalogOption; years: Set<number> }> }>();
  const currentYear = new Date().getFullYear();

  for (const row of rows) {
    const identity = getIdentity(row);
    if (!identity || !row.year_start) continue;
    const make = makes.get(identity.make.id) ?? {
      option: { id: identity.make.id, name: identity.make.name },
      models: new Map()
    };
    const model = make.models.get(identity.model.id) ?? {
      option: { id: identity.model.id, name: identity.model.name },
      years: new Set<number>()
    };
    for (let year = row.year_start; year <= (row.year_end ?? currentYear); year += 1) model.years.add(year);
    make.models.set(identity.model.id, model);
    makes.set(identity.make.id, make);
  }

  return sortMakesForNz([...makes.values()].map(({ option, models }) => ({
    ...option,
    models: [...models.values()]
      .map((model) => ({ ...model.option, years: [...model.years].sort((left, right) => right - left) }))
      .sort((left, right) => left.name.localeCompare(right.name))
  })));
}, ["vehicle-catalog-v4-index"], { revalidate: 3600, tags: ["vehicle-catalog-v4"] });

export const listVehicleCatalogModels = unstable_cache(async (makeId: string) => {
  const rows = await loadPublishedVehicleIdentities({ makeId });
  const models = new Map<string, VehicleCatalogOption>();
  for (const row of rows) {
    const identity = getIdentity(row);
    if (identity?.make.id === makeId) models.set(identity.model.id, { id: identity.model.id, name: identity.model.name });
  }
  return [...models.values()].sort((left, right) => left.name.localeCompare(right.name));
}, ["vehicle-catalog-v4-models"], { revalidate: 3600, tags: ["vehicle-catalog-v4"] });

export const listVehicleCatalogYears = unstable_cache(async (makeId: string, modelId: string) => {
  const rows = await loadPublishedVehicleIdentities({ makeId, modelId });
  const years = new Set<number>();
  const currentYear = new Date().getFullYear();

  for (const row of rows) {
    const identity = getIdentity(row);
    if (!identity || identity.make.id !== makeId || identity.model.id !== modelId || !row.year_start) continue;
    const endYear = row.year_end ?? currentYear;
    for (let year = row.year_start; year <= endYear; year += 1) years.add(year);
  }

  return [...years].sort((left, right) => right - left);
}, ["vehicle-catalog-v4-years"], { revalidate: 3600, tags: ["vehicle-catalog-v4"] });

export async function listVehicleCatalogApplicationIds(makeId: string, modelId: string, year: number) {
  const applications = await listVehicleCatalogApplications(makeId, modelId, year);
  return applications.map((application) => application.id);
}

export const listVehicleCatalogApplications = unstable_cache(async (makeId: string, modelId: string, year: number) => {
  if (!Number.isInteger(year) || year < 1886 || year > 2100) return [];

  const rows = await loadPublishedVehicleApplications({ makeId, modelId, year });
  return rows
    .filter((row) => {
      const identity = getIdentity(row);
      if (!identity || identity.make.id !== makeId || identity.model.id !== modelId || !row.year_start) return false;
      return row.year_start <= year && (row.year_end === null || row.year_end >= year);
    })
    .map(mapApplicationOption)
    .filter((option): option is VehicleCatalogApplicationOption => Boolean(option))
    .sort(compareApplicationOptions);
}, ["vehicle-catalog-v4-applications"], { revalidate: 900, tags: ["vehicle-catalog-v4"] });

type VehicleQueryFilters = { makeId?: string; modelId?: string; year?: number };

async function loadPublishedVehicleIdentities(filters: VehicleQueryFilters = {}) {
  const supabase = getSupabaseOrThrow();
  let query = supabase
    .from("vehicle_fitment_applications")
    .select(VEHICLE_IDENTITY_SELECT)
    .like("source_application_key", VEHICLE_CATALOG_SOURCE_PATTERN)
    .eq("fitment_status", "published")
    .eq("active", true)
    .eq("vehicle_generations.active", true);

  query = applyIdentityFilters(query, filters);
  const result = await selectAll(query);
  if (result.error) throw result.error;
  return (result.data ?? []) as unknown as VehicleApplicationRow[];
}

async function loadPublishedVehicleApplications(filters: VehicleQueryFilters = {}) {
  const supabase = getSupabaseOrThrow();
  let query = supabase
    .from("vehicle_fitment_applications")
    .select(VEHICLE_APPLICATION_SELECT)
    .like("source_application_key", VEHICLE_CATALOG_SOURCE_PATTERN)
    .eq("fitment_status", "published")
    .eq("active", true)
    .eq("vehicle_generations.active", true)
    .eq("vehicle_variants.active", true);

  query = applyIdentityFilters(query, filters);
  const result = await selectAll(query);
  if (result.error) throw result.error;
  return (result.data ?? []) as unknown as VehicleApplicationRow[];
}

function applyIdentityFilters<T extends { eq: (column: string, value: string | number) => T; lte: (column: string, value: number) => T; or: (filters: string) => T }>(query: T, filters: VehicleQueryFilters) {
  if (filters.makeId) query = query.eq("vehicle_generations.vehicle_models.make_id", filters.makeId);
  if (filters.modelId) query = query.eq("vehicle_generations.vehicle_models.id", filters.modelId);
  if (filters.year) {
    query = query.lte("year_start", filters.year);
    query = query.or(`year_end.is.null,year_end.gte.${filters.year}`);
  }
  return query;
}

function mapApplicationOption(row: VehicleApplicationRow): VehicleCatalogApplicationOption | null {
  const generation = single(row.vehicle_generations);
  const variant = single(row.vehicle_variants);
  if (!generation || !variant || !row.year_start) return null;

  const chassisCodes = generation.vehicle_chassis_assignments
    .filter((assignment) => !assignment.variant_id || assignment.variant_id === variant.id)
    .sort((left, right) => Number(right.is_primary) - Number(left.is_primary))
    .map((assignment) => single(assignment.vehicle_chassis_codes)?.code?.trim() ?? "")
    .filter(Boolean);
  const engine = variant.engine_code?.trim() ?? "Engine not specified";
  const engineSuffix = variant.engine_code ? ` · ${variant.engine_code}` : "";
  const bodyConfiguration = engineSuffix && variant.name.endsWith(engineSuffix)
    ? variant.name.slice(0, -engineSuffix.length).trim()
    : variant.body_style;

  return {
    id: row.id,
    generationId: generation.id,
    variantId: variant.id,
    chassisCodes: [...new Set(chassisCodes)],
    generationName: generation.name,
    bodyConfiguration,
    bodyStyle: variant.body_style,
    engine,
    yearStart: row.year_start,
    yearEnd: row.year_end
  };
}

function compareApplicationOptions(left: VehicleCatalogApplicationOption, right: VehicleCatalogApplicationOption) {
  return getChassisLabel(left).localeCompare(getChassisLabel(right))
    || left.bodyConfiguration.localeCompare(right.bodyConfiguration)
    || left.engine.localeCompare(right.engine);
}

function getChassisLabel(application: VehicleCatalogApplicationOption) {
  return application.chassisCodes.join(" / ") || application.generationName;
}

function sortMakesForNz<T extends VehicleCatalogOption>(makes: T[]): T[] {
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
