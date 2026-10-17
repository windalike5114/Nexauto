import { NextResponse } from "next/server";
import { listVehicleCatalogModels } from "@/lib/queries/vehicle-catalog";

export async function GET(request: Request) {
  const makeId = new URL(request.url).searchParams.get("makeId");
  if (!makeId) return NextResponse.json({ error: "makeId is required." }, { status: 400 });

  try {
    return NextResponse.json(
      { models: await listVehicleCatalogModels(makeId) },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load vehicle models." },
      { status: 500 }
    );
  }
}
