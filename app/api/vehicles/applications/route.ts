import { NextResponse } from "next/server";
import { listVehicleCatalogApplications } from "@/lib/queries/vehicle-catalog";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const makeId = searchParams.get("makeId");
  const modelId = searchParams.get("modelId");
  const year = Number(searchParams.get("year"));

  if (!makeId || !modelId || !Number.isInteger(year) || year < 1886 || year > 2100) {
    return NextResponse.json({ error: "A valid makeId, modelId and year are required." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      { applications: await listVehicleCatalogApplications(makeId, modelId, year) },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load vehicle configurations." },
      { status: 500 }
    );
  }
}
