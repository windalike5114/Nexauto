import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getCustomerAddressContext } from "@/lib/application/account/account-context";
import { deleteCustomerVehicleForAccount } from "@/lib/application/account/delete-customer-vehicle";
import { saveCustomerVehicleForAccount } from "@/lib/application/account/save-customer-vehicle";
import { setDefaultCustomerVehicleForAccount } from "@/lib/application/account/set-default-customer-vehicle";
import { updateCustomerVehicleForAccount } from "@/lib/application/account/update-customer-vehicle";
import { CustomerVehicleError } from "@/lib/domain/account/customer-vehicle.errors";
import { createSupabaseAccountVehicleRepository } from "@/lib/infrastructure/supabase/account-vehicle.repository";

export async function POST(request: Request) {
  const context = await resolveContext("Sign in to save vehicles.");
  if (!context.ok) return context.response;

  const body = await readJson(request);
  if (!body.ok) return body.response;
  try {
    const vehicle = await saveCustomerVehicleForAccount(context.context, body.data, createSupabaseAccountVehicleRepository());
    return NextResponse.json({ vehicle });
  } catch (nextError) {
    return handleVehicleError(nextError);
  }
}

export async function PATCH(request: Request) {
  const context = await resolveContext("Sign in to manage vehicles.");
  if (!context.ok) return context.response;

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const vehicleId = typeof body.data.id === "string" ? body.data.id : "";
  if (!vehicleId) return NextResponse.json({ error: "Vehicle id is required." }, { status: 400 });

  try {
    if (body.data.isDefault === true) {
      const vehicle = await setDefaultCustomerVehicleForAccount(context.context, vehicleId, createSupabaseAccountVehicleRepository());
      return NextResponse.json({ vehicle });
    }

    const vehicle = await updateCustomerVehicleForAccount(context.context, vehicleId, body.data, createSupabaseAccountVehicleRepository());
    return NextResponse.json({ vehicle });
  } catch (nextError) {
    return handleVehicleError(nextError);
  }
}

export async function DELETE(request: Request) {
  const context = await resolveContext("Sign in to manage vehicles.");
  if (!context.ok) return context.response;

  const vehicleId = new URL(request.url).searchParams.get("id");

  if (!vehicleId) {
    return NextResponse.json({ error: "Vehicle id is required." }, { status: 400 });
  }

  try {
    const result = await deleteCustomerVehicleForAccount(context.context, vehicleId, createSupabaseAccountVehicleRepository());
    return NextResponse.json(result);
  } catch (nextError) {
    return handleVehicleError(nextError);
  }
}

async function resolveContext(unauthorizedMessage: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false as const, response: NextResponse.json({ error: unauthorizedMessage }, { status: 401 }) };
  }

  try {
    return { ok: true as const, context: await getCustomerAddressContext(user) };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: "Could not load account profile." }, { status: 500 }) };
  }
}

async function readJson(request: Request) {
  try {
    const data = await request.json();
    return { ok: true as const, data: isRecord(data) ? data : {} };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: "Vehicle details are invalid." }, { status: 400 }) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function handleVehicleError(error: unknown) {
  if (error instanceof CustomerVehicleError) {
    const status =
      error.code === "CUSTOMER_VEHICLE_VALIDATION_FAILED"
        ? 400
        : error.code === "CUSTOMER_VEHICLE_NOT_FOUND" || error.code === "CUSTOMER_VEHICLE_OWNERSHIP_FAILED"
          ? 404
          : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ error: "Vehicle request could not be completed." }, { status: 500 });
}
