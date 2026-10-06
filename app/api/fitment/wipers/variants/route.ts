import { NextResponse } from "next/server";
import { listWiperFitmentVariants } from "@/lib/queries/wiper-fitment";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const makeId = searchParams.get("makeId");
  const modelId = searchParams.get("modelId");
  const year = Number(searchParams.get("year"));

  if (!makeId || !modelId || !Number.isFinite(year)) {
    return NextResponse.json({ error: "makeId, modelId, and year are required." }, { status: 400 });
  }

  try {
    const variants = await listWiperFitmentVariants(makeId, modelId, year);
    return NextResponse.json({ variants });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load vehicle variants." },
      { status: 500 }
    );
  }
}
