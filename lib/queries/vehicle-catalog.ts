import { createSupabaseServerClient } from "@/lib/supabase";

export type VehicleCatalogOption = { id: string; name: string };

type VehicleMake = VehicleCatalogOption;
type VehicleModel = VehicleCatalogOption & {
  make_id: string;
  vehicle_makes: VehicleMake | VehicleMake[] | null;
};
type VehicleGeneration = VehicleCatalogOption & {
  active: boolean;
  vehicle_models: VehicleModel | VehicleModel[] | null;
};

type VehicleApplicationRow = {
  id: string;
  year_start: number | null;
  year_end: number | null;
  vehicle_generations: VehicleGeneration | VehicleGeneration[] | null;
};

const PRIORITY_NZ_MAKES = ["Toyota", "Ford", "Mazda", "Nissan", "Mitsubishi", "Honda", "Subaru", "Hyundai", "Kia", "Suzuki"];

const VEHICLE_APPLICATION_SELECT = `
  id,
  year_start,
  year_end,
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

export async function listVehicleCatalogMakes() {
  const rows = await loadPublishedVehicleApplications();
  const makes = new Map<string, VehicleCatalogOption>();
  for (const row of rows) {
    const identity = getIdentity(row);
    if (identity) makes.set(identity.make.id, { id: identity.make.id, name: identity.make.name });
  }
  return sortMakesForNz([...makes.values()]);
}

export async function listVehicleCatalogModels(makeId: string) {
  const rows = await loadPublishedVehicleApplications();
  const models = new Map<string, VehicleCatalogOption>();
  for (const row of rows) {
    const identity = getIdentity(row);
    if (identity?.make.id === makeId) models.set(identity.model.id, { id: identity.model.id, name: identity.model.name });
  }
  return [...models.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function listVehicleCatalogYears(makeId: string, modelId: string) {
  const rows = await loadPublishedVehicleApplications();
  const years = new Set<number>();
  const currentYear = new Date().getFullYear();

  for (const row of rows) {
    const identity = getIdentity(row);
    if (!identity || identity.make.id !== makeId || identity.model.id !== modelId || !row.year_start) continue;
    const endYear = row.year_end ?? currentYear;
    for (let year = row.year_start; year <= endYear; year += 1) years.add(year);
  }

  return [...years].sort((left, right) => right - left);
}

async function loadPublishedVehicleApplications() {
  const supabase = getSupabaseOrThrow();
  const result = await selectAll(
    supabase
      .from("vehicle_fitment_applications")
      .select(VEHICLE_APPLICATION_SELECT)
      .eq("fitment_status", "published")
      .eq("active", true)
      .eq("vehicle_generations.active", true)
  );
  if (result.error) throw result.error;
  return (result.data ?? []) as unknown as VehicleApplicationRow[];
}

function sortMakesForNz(makes: VehicleCatalogOption[]) {
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
