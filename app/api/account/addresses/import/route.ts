import { NextResponse } from "next/server";
import { getCustomerAddressContext } from "@/lib/application/account/account-context";
import { importLocalAddresses } from "@/lib/application/account/import-local-addresses";
import { createSupabaseAccountAddressRepository } from "@/lib/infrastructure/supabase/account-address.repository";
import { createClient } from "@/utils/supabase/server";

export async function POST(request: Request) {
  const context = await resolveContext();
  if (!context.ok) return context.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Address import payload is invalid." }, { status: 400 });
  }

  try {
    const result = await importLocalAddresses(context.context, body, createSupabaseAccountAddressRepository());
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Saved addresses could not be imported." }, { status: 500 });
  }
}

async function resolveContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false as const, response: NextResponse.json({ error: "Sign in to import addresses." }, { status: 401 }) };
  }

  try {
    return { ok: true as const, context: await getCustomerAddressContext(user) };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: "Could not load account profile." }, { status: 500 }) };
  }
}
