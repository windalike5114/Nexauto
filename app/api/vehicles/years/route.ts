import { NextResponse } from "next/server";
import { listVehicleCatalogYears } from "@/lib/queries/vehicle-catalog";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const makeId = searchParams.get("makeId");
  const modelId = searchParams.get("modelId");
  if (!makeId || !modelId) {
    return NextResponse.json({ error: "makeId and modelId are required." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      { years: await listVehicleCatalogYears(makeId, modelId) },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load vehicle years." },
      { status: 500 }
    );
  }
}
