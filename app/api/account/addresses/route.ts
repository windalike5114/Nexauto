import { NextResponse } from "next/server";
import { createCustomerAddress } from "@/lib/application/account/create-customer-address";
import { listCustomerAddresses } from "@/lib/application/account/list-customer-addresses";
import { getCustomerAddressContext } from "@/lib/application/account/account-context";
import { CustomerAddressError } from "@/lib/domain/account/customer-address.errors";
import { createSupabaseAccountAddressRepository } from "@/lib/infrastructure/supabase/account-address.repository";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  const context = await resolveContext();
  if (!context.ok) return context.response;

  try {
    const addresses = await listCustomerAddresses(context.context, createSupabaseAccountAddressRepository());
    return NextResponse.json({ addresses });
  } catch {
    return NextResponse.json({ error: "Could not load addresses." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const context = await resolveContext();
  if (!context.ok) return context.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Address details are invalid." }, { status: 400 });
  }

  try {
    const address = await createCustomerAddress(context.context, body, createSupabaseAccountAddressRepository());
    return NextResponse.json({ address }, { status: 201 });
  } catch (error) {
    return handleAddressError(error);
  }
}

async function resolveContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false as const, response: NextResponse.json({ error: "Sign in to manage addresses." }, { status: 401 }) };
  }

  try {
    return { ok: true as const, context: await getCustomerAddressContext(user) };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: "Could not load account profile." }, { status: 500 }) };
  }
}

function handleAddressError(error: unknown) {
  if (error instanceof CustomerAddressError) {
    const status = error.code === "ADDRESS_VALIDATION_FAILED" ? 400 : error.code === "ADDRESS_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ error: "Address request could not be completed." }, { status: 500 });
}
