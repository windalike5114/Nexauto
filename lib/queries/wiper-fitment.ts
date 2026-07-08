import { createSupabaseServerClient } from "@/lib/supabase";

export type WiperFitmentMake = {
  id: string;
  name: string;
};

export type WiperFitmentModel = {
  id: string;
  name: string;
};

export type WiperFitmentResult = {
  applicationId: string;
  make: string;
  model: string;
  startRaw: string | null;
  endRaw: string | null;
  driverLengthIn: number | null;
  passengerLengthIn: number | null;
  rearLengthIn: number | null;
};

type ApplicationMakeRow = {
  vehicle_applications: {
    vehicle_makes: WiperFitmentMake | WiperFitmentMake[] | null;
  } | null;
};

type ApplicationModelRow = {
  model_id: string;
  vehicle_models: WiperFitmentModel | WiperFitmentModel[] | null;
};

type ApplicationYearRow = {
  year_start: number | null;
  year_end: number | null;
};

type ApplicationFitmentRow = {
  id: string;
  start_raw: string | null;
  end_raw: string | null;
  vehicle_makes: { name: string } | Array<{ name: string }> | null;
  vehicle_models: { name: string } | Array<{ name: string }> | null;
  wiper_length_fitments: Array<{
    driver_length_in: string | number | null;
    passenger_length_in: string | number | null;
    rear_length_in: string | number | null;
  }> | null;
};

function getSupabaseOrThrow() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase is not configured for fitment lookup.");
  }

  return supabase;
}

function single<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function listWiperFitmentMakes() {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await selectAll(
    supabase
    .from("wiper_length_fitments")
    .select("vehicle_applications(vehicle_makes(id,name))")
    .order("created_at", { ascending: true })
  );

  if (error) throw error;

  const makes = new Map<string, WiperFitmentMake>();
  for (const row of (data ?? []) as unknown as ApplicationMakeRow[]) {
    const make = single(row.vehicle_applications?.vehicle_makes);
    if (make?.id) makes.set(make.id, { id: make.id, name: make.name });
  }

  return [...makes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listWiperFitmentModels(makeId: string) {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("vehicle_applications")
    .select("model_id,vehicle_models(id,name)")
    .eq("make_id", makeId)
    .eq("active", true)
    .order("model_id");

  if (error) throw error;

  const models = new Map<string, WiperFitmentModel>();
  for (const row of (data ?? []) as unknown as ApplicationModelRow[]) {
    const model = single(row.vehicle_models);
    if (model?.id) models.set(model.id, { id: model.id, name: model.name });
  }

  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listWiperFitmentYears(makeId: string, modelId: string) {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("vehicle_applications")
    .select("year_start,year_end")
    .eq("make_id", makeId)
    .eq("model_id", modelId)
    .eq("active", true);

  if (error) throw error;

  const years = new Set<number>();
  for (const row of (data ?? []) as ApplicationYearRow[]) {
    if (!row.year_start || !row.year_end) continue;
    for (let year = row.year_start; year <= row.year_end; year += 1) {
      years.add(year);
    }
  }

  return [...years].sort((a, b) => b - a);
}

export async function findWiperLengthFitments(makeId: string, modelId: string, year: number) {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("vehicle_applications")
    .select(`
      id,
      start_raw,
      end_raw,
      vehicle_makes(name),
      vehicle_models(name),
      wiper_length_fitments(driver_length_in,passenger_length_in,rear_length_in)
    `)
    .eq("make_id", makeId)
    .eq("model_id", modelId)
    .lte("year_start", year)
    .gte("year_end", year)
    .eq("active", true)
    .order("year_start", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as unknown as ApplicationFitmentRow[])
    .map((row): WiperFitmentResult | null => {
      const fitment = row.wiper_length_fitments?.[0];
      if (!fitment) return null;

      return {
        applicationId: row.id,
        make: single(row.vehicle_makes)?.name ?? "",
        model: single(row.vehicle_models)?.name ?? "",
        startRaw: row.start_raw,
        endRaw: row.end_raw,
        driverLengthIn: toNumber(fitment.driver_length_in),
        passengerLengthIn: toNumber(fitment.passenger_length_in),
        rearLengthIn: toNumber(fitment.rear_length_in)
      };
    })
    .filter((entry): entry is WiperFitmentResult => Boolean(entry));
}

function toNumber(value: string | number | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function selectAll<T>(query: { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> }, size = 1000) {
  const data: T[] = [];

  for (let from = 0; ; from += size) {
    const to = from + size - 1;
    const result = await query.range(from, to);
    if (result.error) return { data, error: result.error };
    data.push(...(result.data ?? []));
    if (!result.data || result.data.length < size) {
      return { data, error: null };
    }
  }
}
