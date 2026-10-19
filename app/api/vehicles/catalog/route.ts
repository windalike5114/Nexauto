import { NextResponse } from "next/server";
import { listVehicleCatalogIndex } from "@/lib/queries/vehicle-catalog";

export async function GET() {
  try {
    return NextResponse.json(
      { makes: await listVehicleCatalogIndex() },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load vehicle catalogue." },
      { status: 500 }
    );
  }
}
