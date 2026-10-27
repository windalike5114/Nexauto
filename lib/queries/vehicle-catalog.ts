import { unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase";
import { groupCatalogModels, type CatalogModelGroup } from "@/lib/vehicle-catalog-display";
import { mapVehicleApplications, vehicleApplicationProjection, type JoinedVehicleApplication, type VehicleCatalogApplicationOption } from '@/lib/application/fitment/vehicle-application-data';
import { timeVehicleLookup } from '@/lib/application/fitment/vehicle-lookup-timing';
export type { VehicleCatalogApplicationOption } from '@/lib/application/fitment/vehicle-application-data';

export type VehicleCatalogOption = { id: string; name: string };
export type VehicleCatalogIndexModel = CatalogModelGroup;
export type VehicleCatalogIndexMake = VehicleCatalogOption & { models: VehicleCatalogIndexModel[] };
type CatalogIndexRow = { make_id: string; make_name: string; model_id: string; model_name: string; years: number[] };
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
    models: groupCatalogModels(make.name, [...make.models].map(([modelId, model]) => ({ id: modelId, name: model.name, years: [...model.years] })))
  })));
}, ["vehicle-catalog-v5-display-index-20261026-r2"], { revalidate: 3600, tags: ["vehicle-catalog-v5"] });

export async function listVehicleCatalogMakes() {
  return (await listVehicleCatalogIndex()).map(({ id, name }) => ({ id, name }));
}

export async function listVehicleCatalogModels(makeId: string) {
  return (await listVehicleCatalogIndex()).find((make) => make.id === makeId)?.models ?? [];
}

export async function listVehicleCatalogYears(makeId: string, modelId: string) {
  return (await listVehicleCatalogIndex()).find((make) => make.id === makeId)?.models.find((model) => model.modelIds.includes(modelId))?.years ?? [];
}

export const listVehicleCatalogApplications = unstable_cache(async (makeId: string, modelId: string, year: number): Promise<VehicleCatalogApplicationOption[]> => {
  if (!/^mk_[0-9a-f]{20}$/.test(makeId) || !/^md_[0-9a-f]{20}$/.test(modelId) || !Number.isInteger(year) || year < 1886 || year > 2100) return [];
  const { listPublicVehicleModels } = await import('@/lib/queries/public-vehicle-catalog');
  const models = await timeVehicleLookup('applications.model-scope', () => listPublicVehicleModels(makeId));
  const model = models.find(entry => entry.modelIds.includes(modelId));
  if (!model) return [];
  const result = await timeVehicleLookup('applications.database', async () => {
    const response = await getSupabaseOrThrow()
      .from('vehicle_catalog_application_years').select(vehicleApplicationProjection)
      .eq('model_year', year).in('application.model_id', model.modelIds)
      .eq('application.status', 'active').eq('application.model.status', 'active')
      .eq('application.model.make_id', makeId).eq('application.model.make.status', 'active')
      .order('application_id').limit(501);
    if (response.error) throw response.error;
    return response;
  });
  return mapVehicleApplications((result.data ?? []) as unknown as JoinedVehicleApplication[]);
}, ["vehicle-catalog-v5-friendly-applications-scoped-join-r2"], { revalidate: 900, tags: ["vehicle-catalog-v5"] });

export async function listVehicleCatalogApplicationIds(makeId: string, modelId: string, year: number) {
  return (await listVehicleCatalogApplications(makeId, modelId, year)).map((row) => row.id);
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
