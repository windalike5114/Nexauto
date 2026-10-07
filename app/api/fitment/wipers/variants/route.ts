import {
  fitmentJson,
  guardFitmentApiRequest,
  hasOnlySearchParams,
  parseFitmentId,
  parseVehicleYear
} from "@/lib/application/fitment/public-api";
import { listWiperFitmentVariants } from "@/lib/queries/wiper-fitment";

const MAX_PUBLIC_VARIANTS = 50;

export async function GET(request: Request) {
  const guard = guardFitmentApiRequest(request);
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const makeId = parseFitmentId(searchParams.get("makeId"));
  const modelId = parseFitmentId(searchParams.get("modelId"));
  const year = parseVehicleYear(searchParams.get("year"));

  if (!makeId || !modelId || !year || !hasOnlySearchParams(searchParams, ["makeId", "modelId", "year"])) {
    return fitmentJson({ error: "Valid makeId, modelId, and year values are required." }, guard, { status: 400 });
  }

  try {
    const resolution = await listWiperFitmentVariants(makeId, modelId, year);
    return fitmentJson({
      ...resolution,
      variants: resolution.variants.slice(0, MAX_PUBLIC_VARIANTS)
    }, guard);
  } catch {
    return fitmentJson({ error: "Could not load vehicle variants." }, guard, { status: 500 });
  }
}
