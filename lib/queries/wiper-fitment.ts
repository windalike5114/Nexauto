import { createSupabaseServerClient } from "@/lib/supabase";

export type WiperFitmentMake = { id: string; name: string };
export type WiperFitmentModel = { id: string; name: string };
export type WiperFitmentModelGroup = WiperFitmentModel & {
  aliases: string[];
  modelIds: string[];
};
export type WiperFitmentApplicationKind = "legacy" | "canonical";

export type WiperFitmentVariant = {
  id: string;
  key: string;
  name: string;
  applicationKind: WiperFitmentApplicationKind;
};

export type WiperFitmentVariantResolution = {
  variants: WiperFitmentVariant[];
  automaticVariant: WiperFitmentVariant | null;
  requiresSelection: boolean;
};

export type WiperFitmentResult = {
  applicationId: string;
  applicationKind: WiperFitmentApplicationKind;
  make: string;
  model: string;
  generationName: string | null;
  chassisCodes?: string[];
  variantName: string | null;
  bodyStyle: string | null;
  startRaw: string | null;
  endRaw: string | null;
  startYear: number | null;
  endYear: number | null;
  driverLengthIn: number | null;
  passengerLengthIn: number | null;
  rearLengthIn: number | null;
};

export type PublicWiperFitmentResult = Pick<
  WiperFitmentResult,
  "applicationId" | "applicationKind" | "driverLengthIn" | "passengerLengthIn" | "rearLengthIn"
> & {
  yearRange: string;
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
      vehicle_chassis_assignments(
        id,
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
  vehicle_chassis_assignments?: Array<{
    id: string;
    variant_id: string | null;
    is_primary: boolean;
    vehicle_chassis_codes: { code: string } | Array<{ code: string }> | null;
  }> | null;
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
  const [legacy, canonical, masterCatalog] = await Promise.all([
    supabase.from("vehicle_applications").select("model_id,vehicle_models(id,name)").eq("make_id", makeId).eq("active", true).order("model_id"),
    loadPublishedCanonicalFitments(supabase),
    loadMachterMasterModels(supabase, makeId)
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
  return groupWiperFitmentModelsUsingMaster([...models.values()], masterCatalog.models, masterCatalog.requestedMakeName);
}

export async function listWiperFitmentYears(makeId: string, modelId: string) {
  const group = await resolveWiperFitmentModelGroup(makeId, modelId);
  if (!group) return [];

  const supabase = getSupabaseOrThrow();
  const [legacy, canonical] = await Promise.all([
    supabase
      .from("vehicle_applications")
      .select("year_start,year_end")
      .eq("make_id", makeId)
      .in("model_id", group.modelIds)
      .eq("active", true),
    loadPublishedCanonicalFitments(supabase)
  ]);
  if (legacy.error) throw legacy.error;
  if (canonical.error) throw canonical.error;

  const years = new Set<number>();
  for (const row of (legacy.data ?? []) as ApplicationYearRow[]) addYears(years, row.year_start, row.year_end, false);
  const modelIds = new Set(group.modelIds);
  for (const row of canonical.data) {
    const identity = getCanonicalIdentity(row);
    if (identity?.make.id === makeId && modelIds.has(identity.model.id)) {
      addYears(years, identity.application.year_start, identity.application.year_end, true);
    }
  }
  return [...years].sort((a, b) => b - a);
}

export async function listWiperFitmentVariants(makeId: string, modelId: string, year: number) {
  const { group, results } = await loadWiperLengthFitments(makeId, modelId, year);
  if (!group) return { variants: [], automaticVariant: null, requiresSelection: false };
  return buildWiperFitmentVariantResolution(results, group.name);
}

export async function findWiperLengthFitments(
  makeId: string,
  modelId: string,
  year: number,
  selection?: { applicationId: string; applicationKind: WiperFitmentApplicationKind }
) {
  const { results } = await loadWiperLengthFitments(makeId, modelId, year, selection);
  return results;
}

async function loadWiperLengthFitments(
  makeId: string,
  modelId: string,
  year: number,
  selection?: { applicationId: string; applicationKind: WiperFitmentApplicationKind }
) {
  const group = await resolveWiperFitmentModelGroup(makeId, modelId);
  if (!group) return { group: null, results: [] as WiperFitmentResult[] };

  const supabase = getSupabaseOrThrow();
  const [legacy, canonical] = await Promise.all([
    supabase
      .from("vehicle_applications")
      .select(`id,start_raw,end_raw,year_start,year_end,vehicle_makes(name),vehicle_models(name),wiper_length_fitments(driver_length_in,passenger_length_in,rear_length_in)`)
      .eq("make_id", makeId)
      .in("model_id", group.modelIds)
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
  const modelIds = new Set(group.modelIds);
  const canonicalResults = canonical.data
    .filter((row) => canonicalFitsVehicle(row, makeId, modelIds, year))
    .map(mapCanonicalFitmentRow)
    .filter((entry): entry is WiperFitmentResult => Boolean(entry));

  const results = [...legacyResults, ...canonicalResults]
    .filter((entry) => !selection || (entry.applicationId === selection.applicationId && entry.applicationKind === selection.applicationKind))
    .sort((left, right) => compareFitments(left, right, group.name));

  return { group, results };
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
    chassisCodes: [],
    variantName: null,
    bodyStyle: null,
    startRaw: row.start_raw,
    endRaw: row.end_raw,
    startYear: row.year_start,
    endYear: row.year_end,
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
  const chassisCodes = (identity.generation.vehicle_chassis_assignments ?? [])
    .filter((assignment) => !assignment.variant_id || assignment.variant_id === variant?.id)
    .sort((left, right) => Number(right.is_primary) - Number(left.is_primary))
    .map((assignment) => single(assignment.vehicle_chassis_codes)?.code?.trim() ?? "")
    .filter(Boolean);
  const blades = new Map(configuration.wiper_configuration_blades.map((blade) => [blade.position, toNumber(blade.length_in)]));
  return {
    applicationId: identity.application.id,
    applicationKind: "canonical",
    make: identity.make.name,
    model: identity.model.name,
    generationName: identity.generation.name,
    chassisCodes: [...new Set(chassisCodes)],
    variantName: variant?.name ?? null,
    bodyStyle: variant?.body_style ?? null,
    startRaw: identity.application.year_start ? String(identity.application.year_start) : null,
    endRaw: identity.application.year_end ? String(identity.application.year_end) : "ON",
    startYear: identity.application.year_start,
    endYear: identity.application.year_end,
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

function canonicalFitsVehicle(row: CanonicalFitmentRow, makeId: string, modelIds: Set<string>, year: number) {
  const identity = getCanonicalIdentity(row);
  if (!identity || identity.make.id !== makeId || !modelIds.has(identity.model.id)) return false;
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

async function loadMachterMasterModels(supabase: ReturnType<typeof getSupabaseOrThrow>, makeId: string) {
  const [{ data: source, error: sourceError }, { data: makes, error: makesError }] = await Promise.all([
    supabase.from("catalog_data_sources").select("id").eq("code", "MACHTER_VEHICLE_CATALOG").eq("active", true).maybeSingle(),
    supabase.from("vehicle_makes").select("id,name")
  ]);
  if (sourceError) throw sourceError;
  if (makesError) throw makesError;
  const requestedMake = (makes ?? []).find((make) => make.id === makeId) ?? null;
  const targetMakeKey = requestedMake ? canonicalMakeNameKey(requestedMake.name) : "";
  const makeCandidates = requestedMake
    ? (makes ?? []).filter((make) => canonicalMakeNameKey(make.name) === targetMakeKey)
    : [];
  const canonicalMake = requestedMake
    ? makeCandidates.find((make) => normalizeModelName(make.name).toLowerCase() === targetMakeKey) ?? makeCandidates[0] ?? requestedMake
    : null;
  if (!source || !canonicalMake) return { models: [], requestedMakeName: requestedMake?.name ?? "" };

  const [aliases, models] = await Promise.all([
    selectAll(
      supabase
        .from("vehicle_entity_aliases")
        .select("model_id")
        .eq("data_source_id", source.id)
        .eq("entity_type", "model")
        .eq("alias_kind", "name")
    ),
    supabase.from("vehicle_models").select("id,name").eq("make_id", canonicalMake.id)
  ]);
  if (aliases.error) throw aliases.error;
  if (models.error) throw models.error;
  const masterIds = new Set((aliases.data ?? []).map((alias: { model_id: string | null }) => alias.model_id).filter(Boolean));
  return {
    models: ((models.data ?? []) as WiperFitmentModel[]).filter((model) => masterIds.has(model.id)),
    requestedMakeName: requestedMake?.name ?? ""
  };
}

function addYears(years: Set<number>, start: number | null, end: number | null, allowOpenEnded: boolean) {
  if (!start) return;
  const finalYear = end ?? (allowOpenEnded ? new Date().getFullYear() : null);
  if (!finalYear) return;
  for (let year = start; year <= finalYear; year += 1) years.add(year);
}

export function toPublicWiperFitmentResult(fitment: WiperFitmentResult): PublicWiperFitmentResult {
  return {
    applicationId: fitment.applicationId,
    applicationKind: fitment.applicationKind,
    yearRange: formatWiperFitmentYearRange(fitment),
    driverLengthIn: fitment.driverLengthIn,
    passengerLengthIn: fitment.passengerLengthIn,
    rearLengthIn: fitment.rearLengthIn
  };
}

export function formatWiperFitmentVariantLabel(fitment: WiperFitmentResult, displayModelName?: string) {
  const modelVersion = displayModelName ? extractModelVersion(fitment.model, displayModelName) : null;
  if (fitment.applicationKind === "legacy") {
    const descriptor = extractParentheticalDescriptors(fitment.startRaw, fitment.endRaw);
    const chassis = descriptor && (!modelVersion || !containsWholeValue(modelVersion, descriptor)) ? descriptor : null;
    return [modelVersion || descriptor || "Standard", formatWiperFitmentYearRange(fitment), modelVersion ? chassis : null]
      .filter(Boolean)
      .join(" · ");
  }
  const seen = new Set<string>();
  const parts = [
    modelVersion,
    fitment.chassisCodes?.join(" / ") || null,
    fitment.generationName,
    fitment.variantName,
    formatBodyStyle(fitment.bodyStyle),
    formatWiperFitmentYearRange(fitment)
  ].filter((part): part is string => {
    if (!part) return false;
    const key = part.trim().toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return parts.length ? parts.join(" · ") : formatWiperFitmentYearRange(fitment);
}

export function formatWiperFitmentYearRange(fitment: WiperFitmentResult) {
  if (fitment.startYear) {
    if (fitment.endYear && fitment.endYear !== fitment.startYear) return `${fitment.startYear}–${fitment.endYear}`;
    if (fitment.endYear === fitment.startYear) return String(fitment.startYear);
    if (fitment.applicationKind === "canonical") return `${fitment.startYear}–ON`;
  }

  const start = normalizeRangeText(fitment.startRaw);
  const end = normalizeRangeText(fitment.endRaw);
  if (start && end && start.toLowerCase() === end.toLowerCase()) return start;
  if (start && end && containsWholeValue(start, end)) return start;
  if (start && end && containsWholeValue(end, start)) return end;
  return start && end ? `${start}–${end}` : start || end || "Unknown";
}

function formatBodyStyle(value: string | null) {
  if (!value || value === "unknown") return null;
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function compareFitments(left: WiperFitmentResult, right: WiperFitmentResult, displayModelName?: string) {
  if (left.applicationKind !== right.applicationKind) return left.applicationKind === "canonical" ? -1 : 1;
  return formatWiperFitmentVariantLabel(left, displayModelName).localeCompare(formatWiperFitmentVariantLabel(right, displayModelName));
}

export function groupWiperFitmentModels(models: WiperFitmentModel[]): WiperFitmentModelGroup[] {
  const uniqueModels = [...new Map(models.map((model) => [model.id, model])).values()];
  const names = [...new Set(uniqueModels.map((model) => normalizeModelName(model.name)))];
  const groups = new Map<string, WiperFitmentModel[]>();

  for (const model of uniqueModels) {
    const groupName = findDisplayModelName(model.name, names);
    const members = groups.get(groupName) ?? [];
    members.push(model);
    groups.set(groupName, members);
  }

  return [...groups.entries()]
    .map(([name, members]) => {
      const sortedMembers = [...members].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
      const representative = sortedMembers.find((model) => normalizeModelName(model.name).toLowerCase() === name.toLowerCase()) ?? sortedMembers[0];
      return {
        id: representative.id,
        name,
        aliases: [...new Set(sortedMembers.map((model) => normalizeModelName(model.name)))],
        modelIds: sortedMembers.map((model) => model.id)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function groupWiperFitmentModelsUsingMaster(
  models: WiperFitmentModel[],
  masterModels: WiperFitmentModel[],
  makeName?: string
): WiperFitmentModelGroup[] {
  const masterGroups = new Map<string, { master: WiperFitmentModel; members: Map<string, WiperFitmentModel> }>();
  const unmatched: WiperFitmentModel[] = [];

  for (const model of models) {
    const master = resolveMasterModel(model.name, masterModels, makeName);
    if (!master) {
      unmatched.push(model);
      continue;
    }
    const group = masterGroups.get(master.id) ?? { master, members: new Map() };
    group.members.set(master.id, master);
    group.members.set(model.id, model);
    masterGroups.set(master.id, group);
  }

  const mastered = [...masterGroups.values()].map(({ master, members }) => {
    const sortedMembers = [...members.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    return {
      id: master.id,
      name: master.name,
      aliases: [...new Set(sortedMembers.map((model) => normalizeModelName(model.name)))],
      modelIds: sortedMembers.map((model) => model.id)
    };
  });
  return [...mastered, ...groupWiperFitmentModels(unmatched)].sort((left, right) => left.name.localeCompare(right.name));
}

export function buildWiperFitmentVariantResolution(
  fitments: WiperFitmentResult[],
  displayModelName: string
): WiperFitmentVariantResolution {
  const variants = fitments.map((fitment): WiperFitmentVariant => ({
    id: fitment.applicationId,
    key: `${fitment.applicationKind}:${fitment.applicationId}`,
    name: formatWiperFitmentVariantLabel(fitment, displayModelName),
    applicationKind: fitment.applicationKind
  }));
  const automaticVariant = canProveFitmentsEquivalent(fitments, displayModelName) ? variants[0] ?? null : null;
  return {
    variants,
    automaticVariant,
    requiresSelection: variants.length > 1 && !automaticVariant
  };
}

async function resolveWiperFitmentModelGroup(makeId: string, modelId: string) {
  const groups = await listWiperFitmentModels(makeId);
  return groups.find((group) => group.modelIds.includes(modelId)) ?? null;
}

function findDisplayModelName(modelName: string, knownNames: string[]) {
  const normalized = normalizeModelName(modelName);
  const candidates = knownNames
    .filter((candidate) => candidate.length < normalized.length && normalized.toLowerCase().startsWith(`${candidate.toLowerCase()} `))
    .sort((left, right) => right.length - left.length);

  for (const candidate of candidates) {
    const suffix = normalized.slice(candidate.length).replace(/^\s*[–—-]\s*/, "").trim();
    const hasExplicitSeparator = new RegExp(`^${escapeRegExp(candidate)}\\s+[–—-]\\s+`, "i").test(normalized);
    if (hasExplicitSeparator || looksLikeVehicleVersion(suffix)) return candidate;
  }
  return normalized;
}

function resolveMasterModel(modelName: string, masterModels: WiperFitmentModel[], makeName?: string) {
  const candidates = [normalizeModelName(modelName)];
  if (makeName && candidates[0].toLowerCase().startsWith(makeName.toLowerCase())) {
    const withoutMake = candidates[0].slice(makeName.length).replace(/^\s*[–—-]?\s*/, "").trim();
    if (withoutMake) candidates.push(withoutMake);
  }

  for (const candidate of candidates) {
    const exact = masterModels.find((model) => normalizeMasterKey(model.name) === normalizeMasterKey(candidate));
    if (exact) return exact;
    const displayName = findDisplayModelName(candidate, masterModels.map((model) => normalizeModelName(model.name)));
    const matched = masterModels.find((model) => normalizeModelName(model.name).toLowerCase() === displayName.toLowerCase());
    if (matched) return matched;

    const contained = masterModels.filter((model) => containsWholeValue(candidate, model.name));
    if (contained.length === 1) return contained[0];
    if (contained.length > 1) {
      const ending = contained.filter((model) => (
        !/[,/]/.test(candidate)
        && normalizeModelName(candidate).toLowerCase().endsWith(normalizeModelName(model.name).toLowerCase())
      ));
      if (ending.length === 1) return ending[0];
      continue;
    }

    const compactCandidate = normalizeMasterKey(candidate);
    const compactPrefixes = masterModels
      .filter((model) => compactCandidate.startsWith(normalizeMasterKey(model.name)))
      .sort((left, right) => normalizeMasterKey(right.name).length - normalizeMasterKey(left.name).length);
    const compactMaster = compactPrefixes[0];
    if (compactMaster) {
      const remainder = compactCandidate.slice(normalizeMasterKey(compactMaster.name).length);
      const hasVersionSignal = /[–—-]/.test(candidate)
        || /\b(sedan|wagon|hatch|liftback|ute|van|coupe|suv|pickup)\b/i.test(candidate)
        || /\d/.test(remainder);
      if (hasVersionSignal) return compactMaster;
    }
  }
  return null;
}

function looksLikeVehicleVersion(suffix: string) {
  const bodyStyle = /\b(sedan|saloon|wagon|estate|hatch|hatchback|liftback|ute|utility|van|coupe|convertible|cab|suv|pickup|roadster)\b/gi;
  const withoutBodyStyles = suffix.replace(bodyStyle, " ").replace(/\b(series|mk)\b/gi, " ");
  const tokens = withoutBodyStyles.split(/[\s,()/–—-]+/).filter(Boolean);
  const isChassisToken = (token: string) => /^(?:[A-Z]{1,3}|(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{2,})$/.test(token);
  const hasVersionSignal = withoutBodyStyles !== suffix || tokens.some(isChassisToken);
  return hasVersionSignal && tokens.every(isChassisToken);
}

function extractModelVersion(modelName: string, displayModelName: string) {
  const normalizedModel = normalizeModelName(modelName);
  const normalizedDisplay = normalizeModelName(displayModelName);
  if (normalizedModel.toLowerCase() === normalizedDisplay.toLowerCase()) return null;
  if (!normalizedModel.toLowerCase().startsWith(`${normalizedDisplay.toLowerCase()} `)) return normalizedModel;
  return normalizedModel.slice(normalizedDisplay.length).replace(/^\s*[–—-]\s*/, "").trim() || null;
}

function canProveFitmentsEquivalent(fitments: WiperFitmentResult[], displayModelName: string) {
  if (fitments.length <= 1) return fitments.length === 1;
  const first = fitments[0];
  if (!hasCompleteKnownFitment(first)) return false;
  const firstSignature = fitmentSignature(first, displayModelName);
  return fitments.every((fitment) => hasCompleteKnownFitment(fitment) && fitmentSignature(fitment, displayModelName) === firstSignature);
}

function hasCompleteKnownFitment(fitment: WiperFitmentResult) {
  return fitment.driverLengthIn !== null && fitment.passengerLengthIn !== null && fitment.rearLengthIn !== null;
}

function fitmentSignature(fitment: WiperFitmentResult, displayModelName: string) {
  const version = [
    extractModelVersion(fitment.model, displayModelName) || "standard",
    fitment.generationName,
    fitment.variantName,
    formatBodyStyle(fitment.bodyStyle)
  ]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
  return `${version}:${fitment.driverLengthIn}:${fitment.passengerLengthIn}:${fitment.rearLengthIn}`;
}

function normalizeModelName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMasterKey(value: string) {
  return normalizeModelName(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function canonicalMakeNameKey(value: string) {
  const key = normalizeModelName(value).toLowerCase();
  const aliases: Record<string, string> = {
    fpv: "ford",
    "ford fpv": "ford",
    mercedes: "mercedes benz",
    "mazda eunos": "eunos",
    "range rover": "land rover"
  };
  return aliases[key] ?? key;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractParentheticalDescriptors(...values: Array<string | null>) {
  const descriptors = new Set<string>();
  for (const value of values) {
    for (const match of value?.matchAll(/\(([^)]+)\)/g) ?? []) {
      const descriptor = normalizeRangeText(match[1] ?? null);
      if (descriptor) descriptors.add(descriptor);
    }
  }
  return [...descriptors].join(", ");
}

function normalizeRangeText(value: string | null) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function containsWholeValue(container: string, value: string) {
  if (!value) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(container);
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
