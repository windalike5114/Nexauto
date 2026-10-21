import { createSupabaseServerClient } from "@/lib/supabase";
import type { WiperFitmentResult } from "@/lib/queries/wiper-fitment";

type CatalogWiperRow = {
  application_id: string;
  wiper_configurations: {
    configuration_status: string;
    wiper_configuration_blades: Array<{ position: string; length_in: string | number }>;
  } | Array<{
    configuration_status: string;
    wiper_configuration_blades: Array<{ position: string; length_in: string | number }>;
  }> | null;
};

export async function findCatalogWiperFitments(applicationIds: string[]): Promise<WiperFitmentResult[]> {
  if (applicationIds.length === 0) return [];
  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured for wiper fitment lookup.");
  const { data, error } = await supabase.from("vehicle_catalog_wiper_fitments")
    .select("application_id,wiper_configurations!inner(configuration_status,wiper_configuration_blades(position,length_in))")
    .in("application_id", applicationIds).eq("fitment_status", "published").eq("wiper_configurations.configuration_status", "published");
  if (error) throw error;
  return ((data ?? []) as unknown as CatalogWiperRow[]).map((row) => {
    const configuration = Array.isArray(row.wiper_configurations) ? row.wiper_configurations[0] : row.wiper_configurations;
    const blades = new Map((configuration?.wiper_configuration_blades ?? []).map((blade) => [blade.position, toNumber(blade.length_in)]));
    return {
      applicationId: row.application_id, applicationKind: "canonical", make: "", model: "", generationName: null,
      variantName: null, bodyStyle: null, startRaw: null, endRaw: null, startYear: null, endYear: null,
      driverLengthIn: blades.get("driver") ?? null, passengerLengthIn: blades.get("passenger") ?? null, rearLengthIn: blades.get("rear") ?? null
    };
  });
}
function toNumber(value: string | number | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
