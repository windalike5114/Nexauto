import { NextResponse } from "next/server";
import { listWiperFitmentModels } from "@/lib/queries/wiper-fitment";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const makeId = searchParams.get("makeId");

  if (!makeId) {
    return NextResponse.json({ error: "makeId is required." }, { status: 400 });
  }

  try {
    const models = await listWiperFitmentModels(makeId);
    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load vehicle models." },
      { status: 500 }
    );
  }
}
