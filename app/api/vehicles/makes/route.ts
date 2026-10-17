import { NextResponse } from "next/server";
import { listVehicleCatalogMakes } from "@/lib/queries/vehicle-catalog";

export async function GET() {
  try {
    return NextResponse.json(
      { makes: await listVehicleCatalogMakes() },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load vehicle makes." },
      { status: 500 }
    );
  }
}
