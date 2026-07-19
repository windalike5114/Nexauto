import { NextResponse } from "next/server";
import { deleteCustomerAddress } from "@/lib/application/account/delete-customer-address";
import { getCustomerAddressContext } from "@/lib/application/account/account-context";
import { updateCustomerAddress } from "@/lib/application/account/update-customer-address";
import { CustomerAddressError } from "@/lib/domain/account/customer-address.errors";
import { createSupabaseAccountAddressRepository } from "@/lib/infrastructure/supabase/account-address.repository";
import { createClient } from "@/utils/supabase/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await resolveContext();
  if (!context.ok) return context.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Address details are invalid." }, { status: 400 });
  }

  try {
    const address = await updateCustomerAddress(context.context, id, body, createSupabaseAccountAddressRepository());
    return NextResponse.json({ address });
  } catch (error) {
    return handleAddressError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await resolveContext();
  if (!context.ok) return context.response;
  const { id } = await params;

  try {
    const result = await deleteCustomerAddress(context.context, id, createSupabaseAccountAddressRepository());
    return NextResponse.json(result);
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
