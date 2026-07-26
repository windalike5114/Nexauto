import { NextResponse, type NextRequest } from "next/server";
import { getAuthCallbackRedirectTarget } from "@/lib/domain/account/auth.schema";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const unsafeNext = requestUrl.searchParams.get("next");
  const next = getAuthCallbackRedirectTarget(unsafeNext);

  if (!code) {
    return NextResponse.redirect(new URL(`/account?auth=invalid-link`, requestUrl.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("auth.callback_exchange_failed", {
      stage: "exchange_code_for_session",
      code: error.code,
      status: error.status,
      name: error.name
    });

    return NextResponse.redirect(new URL(`/account?auth=invalid-link`, requestUrl.origin));
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
