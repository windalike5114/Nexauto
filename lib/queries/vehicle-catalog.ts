import { unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase";

export type VehicleCatalogOption = { id: string; name: string };
export type VehicleCatalogIndexModel = VehicleCatalogOption & { years: number[] };
export type VehicleCatalogIndexMake = VehicleCatalogOption & { models: VehicleCatalogIndexModel[] };
export type VehicleCatalogApplicationOption = {
  id: string; seriesId: string | null; seriesName: string; powertrainId: string; engine: string;
  variantId: string; variantName: string; bodyStyle: string; driveType: string; vehicleClass: string;
};
type CatalogIndexRow = { make_id: string; make_name: string; model_id: string; model_name: string; years: number[] };
type SearchRow = {
  application_id: string; series_id: string | null; series_name: string; powertrain_id: string;
  engine_name: string; variant_id: string; variant_name: string; body_style: string | null;
  drive_type: string | null; vehicle_class: string | null;
};
const PRIORITY_NZ_MAKES = ["Toyota", "Ford", "Mazda", "Nissan", "Mitsubishi", "Honda", "Subaru", "Hyundai", "Kia", "Suzuki"];

function getSupabaseOrThrow() {
  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured for vehicle lookup.");
  return supabase;
}

export const listVehicleCatalogIndex = unstable_cache(async (): Promise<VehicleCatalogIndexMake[]> => {
  const result = await selectAll<CatalogIndexRow>(getSupabaseOrThrow().from("vehicle_catalog_index")
    .select("make_id,make_name,model_id,model_name,years").order("make_id").order("model_id"));
  if (result.error) throw result.error;
  const makes = new Map<string, { name: string; models: Map<string, { name: string; years: Set<number> }> }>();
  for (const row of result.data) {
    const make = makes.get(row.make_id) ?? { name: row.make_name, models: new Map() };
    const model = make.models.get(row.model_id) ?? { name: row.model_name, years: new Set<number>() };
    for (const year of row.years) model.years.add(year);
    make.models.set(row.model_id, model);
    makes.set(row.make_id, make);
  }
  return sortMakesForNz([...makes].map(([id, make]) => ({
    id, name: make.name,
    models: [...make.models].map(([modelId, model]) => ({ id: modelId, name: model.name, years: [...model.years].sort((a, b) => b - a) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })));
}, ["vehicle-catalog-v5-index"], { revalidate: 3600, tags: ["vehicle-catalog-v5"] });

export async function listVehicleCatalogMakes() {
  return (await listVehicleCatalogIndex()).map(({ id, name }) => ({ id, name }));
}

export async function listVehicleCatalogModels(makeId: string) {
  return (await listVehicleCatalogIndex()).find((make) => make.id === makeId)?.models.map(({ id, name }) => ({ id, name })) ?? [];
}

export async function listVehicleCatalogYears(makeId: string, modelId: string) {
  return (await listVehicleCatalogIndex()).find((make) => make.id === makeId)?.models.find((model) => model.id === modelId)?.years ?? [];
}

export const listVehicleCatalogApplications = unstable_cache(async (makeId: string, modelId: string, year: number): Promise<VehicleCatalogApplicationOption[]> => {
  if (!/^mk_[0-9a-f]{20}$/.test(makeId) || !/^md_[0-9a-f]{20}$/.test(modelId) || !Number.isInteger(year) || year < 1886 || year > 2100) return [];
  const result = await selectAll<SearchRow>(getSupabaseOrThrow().from("vehicle_catalog_search")
    .select("application_id,series_id,series_name,powertrain_id,engine_name,variant_id,variant_name,body_style,drive_type,vehicle_class")
    .eq("make_id", makeId).eq("model_id", modelId).eq("model_year", year));
  if (result.error) throw result.error;
  return result.data.map((row) => ({
    id: row.application_id, seriesId: row.series_id, seriesName: row.series_name,
    powertrainId: row.powertrain_id, engine: row.engine_name, variantId: row.variant_id,
    variantName: row.variant_name, bodyStyle: row.body_style ?? "", driveType: row.drive_type ?? "",
    vehicleClass: row.vehicle_class ?? ""
  })).sort(compareApplications);
}, ["vehicle-catalog-v5-applications"], { revalidate: 900, tags: ["vehicle-catalog-v5"] });

export async function listVehicleCatalogApplicationIds(makeId: string, modelId: string, year: number) {
  return (await listVehicleCatalogApplications(makeId, modelId, year)).map((row) => row.id);
}
function compareApplications(a: VehicleCatalogApplicationOption, b: VehicleCatalogApplicationOption) {
  return a.seriesName.localeCompare(b.seriesName) || a.engine.localeCompare(b.engine) || a.variantName.localeCompare(b.variantName) || a.id.localeCompare(b.id);
}
function sortMakesForNz<T extends VehicleCatalogOption>(makes: T[]): T[] {
  const priority = new Map(PRIORITY_NZ_MAKES.map((name, index) => [name.toLowerCase(), index]));
  return [...makes].sort((a, b) => {
    const ai = priority.get(a.name.toLowerCase());
    const bi = priority.get(b.name.toLowerCase());
    return ai !== undefined || bi !== undefined ? (ai ?? 999) - (bi ?? 999) : a.name.localeCompare(b.name);
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
