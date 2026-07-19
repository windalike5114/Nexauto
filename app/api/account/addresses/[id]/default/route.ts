import { NextResponse } from "next/server";
import { getCustomerAddressContext } from "@/lib/application/account/account-context";
import { setDefaultCustomerAddress } from "@/lib/application/account/set-default-customer-address";
import { CustomerAddressError } from "@/lib/domain/account/customer-address.errors";
import { createSupabaseAccountAddressRepository } from "@/lib/infrastructure/supabase/account-address.repository";
import { createClient } from "@/utils/supabase/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await resolveContext();
  if (!context.ok) return context.response;
  const { id } = await params;

  try {
    const address = await setDefaultCustomerAddress(context.context, id, createSupabaseAccountAddressRepository());
    return NextResponse.json({ address });
  } catch (error) {
    if (error instanceof CustomerAddressError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "ADDRESS_NOT_FOUND" ? 404 : 500 });
    }
    return NextResponse.json({ error: "Default address could not be updated." }, { status: 500 });
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
