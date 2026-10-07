import { fitmentJson, guardFitmentApiRequest, hasOnlySearchParams } from "@/lib/application/fitment/public-api";
import { listWiperFitmentMakes } from "@/lib/queries/wiper-fitment";

const MAX_PUBLIC_MAKES = 100;

export async function GET(request: Request) {
  const guard = guardFitmentApiRequest(request);
  if (guard.response) return guard.response;

  const { searchParams } = new URL(request.url);
  if (!hasOnlySearchParams(searchParams, [])) {
    return fitmentJson({ error: "Unsupported fitment query parameters." }, guard, { status: 400 });
  }

  try {
    const makes = await listWiperFitmentMakes();
    return fitmentJson({ makes: makes.slice(0, MAX_PUBLIC_MAKES) }, guard);
  } catch {
    return fitmentJson({ error: "Could not load vehicle makes." }, guard, { status: 500 });
  }
}
