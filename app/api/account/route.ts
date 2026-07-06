import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getOrCreateCustomerProfile, listCustomerVehicles } from "@/lib/queries/account";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const profile = await getOrCreateCustomerProfile(user);
    const vehicles = await listCustomerVehicles(profile.id);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email
      },
      profile,
      vehicles
    });
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "Could not load account." },
      { status: 500 }
    );
  }
}
