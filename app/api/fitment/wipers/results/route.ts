import { NextResponse } from "next/server";
import { findWiperLengthFitments } from "@/lib/queries/wiper-fitment";
import { getWiperRearAddonByLength, getWiperSetByLengths } from "@/lib/queries/wiper-commerce";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const makeId = searchParams.get("makeId");
  const modelId = searchParams.get("modelId");
  const year = Number(searchParams.get("year"));

  if (!makeId || !modelId || !Number.isFinite(year)) {
    return NextResponse.json({ error: "makeId, modelId, and year are required." }, { status: 400 });
  }

  try {
    const fitments = await findWiperLengthFitments(makeId, modelId, year);
    const enrichedFitments = await Promise.all(
      fitments.map(async (fitment) => {
        const [frontPair, rearAddon] = await Promise.all([
          fitment.driverLengthIn && fitment.passengerLengthIn
            ? getWiperSetByLengths(fitment.driverLengthIn, fitment.passengerLengthIn)
            : Promise.resolve(null),
          getWiperRearAddonByLength(fitment.rearLengthIn)
        ]);

        return {
          ...fitment,
          frontPair,
          rearAddon
        };
      })
    );

    return NextResponse.json({ fitments: enrichedFitments });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load wiper fitment." },
      { status: 500 }
    );
  }
}
