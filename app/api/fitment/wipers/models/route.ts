import {
  fitmentJson,
  guardFitmentApiRequest,
  hasOnlySearchParams,
  parseFitmentId
} from "@/lib/application/fitment/public-api";
import { listWiperFitmentModels } from "@/lib/queries/wiper-fitment";

const MAX_PUBLIC_MODELS = 250;

export async function GET(request: Request) {
  const guard = await guardFitmentApiRequest(request);
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const makeId = parseFitmentId(searchParams.get("makeId"));

  if (!makeId || !hasOnlySearchParams(searchParams, ["makeId"])) {
    return fitmentJson({ error: "A valid makeId is required." }, guard, { status: 400 });
  }

  try {
    const models = await listWiperFitmentModels(makeId);
    return fitmentJson({
      models: models.slice(0, MAX_PUBLIC_MODELS).map(({ id, name, aliases, modelIds }) => ({ id, name, aliases, modelIds }))
    }, guard);
  } catch {
    return fitmentJson({ error: "Could not load vehicle models." }, guard, { status: 500 });
  }
}
