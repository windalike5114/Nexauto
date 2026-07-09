import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { removeCustomerVehicle, saveCustomerVehicle } from "@/lib/queries/account";

type SaveVehicleBody = {
  applicationId?: string;
  make?: string;
  model?: string;
  year?: number | string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Sign in to save vehicles." }, { status: 401 });
  }

  const body = (await request.json()) as SaveVehicleBody;
  const year = Number(body.year);

  if (!body.applicationId || !body.make || !body.model || !Number.isFinite(year)) {
    return NextResponse.json({ error: "applicationId, make, model, and year are required." }, { status: 400 });
  }

  try {
    const result = await saveCustomerVehicle(user, {
      applicationId: body.applicationId,
      make: body.make,
      model: body.model,
      year
    });

    return NextResponse.json(result);
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "Could not save vehicle." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Sign in to manage vehicles." }, { status: 401 });
  }

  const vehicleId = new URL(request.url).searchParams.get("id");

  if (!vehicleId) {
    return NextResponse.json({ error: "Vehicle id is required." }, { status: 400 });
  }

  try {
    const result = await removeCustomerVehicle(user, vehicleId);
    return NextResponse.json(result);
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "Could not remove vehicle." },
      { status: 500 }
    );
  }
}
