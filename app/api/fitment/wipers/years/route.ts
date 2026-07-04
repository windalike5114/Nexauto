import { NextResponse } from "next/server";
import { listWiperFitmentYears } from "@/lib/queries/wiper-fitment";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const makeId = searchParams.get("makeId");
  const modelId = searchParams.get("modelId");

  if (!makeId || !modelId) {
    return NextResponse.json({ error: "makeId and modelId are required." }, { status: 400 });
  }

  try {
    const years = await listWiperFitmentYears(makeId, modelId);
    return NextResponse.json({ years });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load vehicle years." },
      { status: 500 }
    );
  }
}
