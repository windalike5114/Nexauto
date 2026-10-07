import {
  fitmentJson,
  guardFitmentApiRequest,
  hasOnlySearchParams,
  parseFitmentId
} from "@/lib/application/fitment/public-api";
import { listWiperFitmentYears } from "@/lib/queries/wiper-fitment";

export async function GET(request: Request) {
  const guard = guardFitmentApiRequest(request);
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const makeId = parseFitmentId(searchParams.get("makeId"));
  const modelId = parseFitmentId(searchParams.get("modelId"));

  if (!makeId || !modelId || !hasOnlySearchParams(searchParams, ["makeId", "modelId"])) {
    return fitmentJson({ error: "Valid makeId and modelId values are required." }, guard, { status: 400 });
  }

  try {
    const years = await listWiperFitmentYears(makeId, modelId);
    return fitmentJson({ years }, guard);
  } catch {
    return fitmentJson({ error: "Could not load vehicle years." }, guard, { status: 500 });
  }
}
