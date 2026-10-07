import {
  fitmentJson,
  guardFitmentApiRequest,
  hasOnlySearchParams,
  parseFitmentId,
  parseVehicleYear
} from "@/lib/application/fitment/public-api";
import {
  findWiperLengthFitments,
  toPublicWiperFitmentResult,
  type WiperFitmentApplicationKind
} from "@/lib/queries/wiper-fitment";
import { getWiperRearAddonByLength, getWiperSetByLengths } from "@/lib/queries/wiper-commerce";

const MAX_PUBLIC_RESULTS = 20;

export async function GET(request: Request) {
  const guard = guardFitmentApiRequest(request);
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  const makeId = parseFitmentId(searchParams.get("makeId"));
  const modelId = parseFitmentId(searchParams.get("modelId"));
  const year = parseVehicleYear(searchParams.get("year"));
  const rawApplicationId = searchParams.get("applicationId");
  const applicationId = rawApplicationId ? parseFitmentId(rawApplicationId) : null;
  const applicationKind = searchParams.get("applicationKind");

  if (
    !makeId ||
    !modelId ||
    !year ||
    !hasOnlySearchParams(searchParams, ["makeId", "modelId", "year", "applicationId", "applicationKind"])
  ) {
    return fitmentJson({ error: "Valid makeId, modelId, and year values are required." }, guard, { status: 400 });
  }

  const hasSelection = rawApplicationId !== null || applicationKind !== null;
  const hasValidSelection = applicationId && (applicationKind === "legacy" || applicationKind === "canonical");
  if (hasSelection && !hasValidSelection) {
    return fitmentJson({ error: "applicationId and applicationKind must form a valid selection." }, guard, { status: 400 });
  }

  try {
    const selection = hasValidSelection
      ? { applicationId, applicationKind: applicationKind as WiperFitmentApplicationKind }
      : undefined;
    const fitments = (await findWiperLengthFitments(makeId, modelId, year, selection)).slice(0, MAX_PUBLIC_RESULTS);
    const enrichedFitments = await Promise.all(
      fitments.map(async (fitment) => {
        const [frontPair, rearAddon] = await Promise.all([
          fitment.driverLengthIn && fitment.passengerLengthIn
            ? getWiperSetByLengths(fitment.driverLengthIn, fitment.passengerLengthIn)
            : Promise.resolve(null),
          getWiperRearAddonByLength(fitment.rearLengthIn)
        ]);

        return {
          ...toPublicWiperFitmentResult(fitment),
          frontPair,
          rearAddon
        };
      })
    );

    return fitmentJson({ fitments: enrichedFitments }, guard);
  } catch {
    return fitmentJson({ error: "Could not load wiper fitment." }, guard, { status: 500 });
  }
}
