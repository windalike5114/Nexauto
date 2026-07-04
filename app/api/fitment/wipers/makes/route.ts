import { NextResponse } from "next/server";
import { listWiperFitmentMakes } from "@/lib/queries/wiper-fitment";

export async function GET() {
  try {
    const makes = await listWiperFitmentMakes();
    return NextResponse.json({ makes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load vehicle makes." },
      { status: 500 }
    );
  }
}
