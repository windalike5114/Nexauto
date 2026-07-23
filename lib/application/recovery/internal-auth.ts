import { NextResponse } from "next/server";

export function assertInternalRecoveryAccess(request: Request) {
  const secret = process.env.INTERNAL_RECOVERY_SECRET ?? process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Recovery endpoint is not configured." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-internal-recovery-secret");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

  if (bearer !== secret && headerSecret !== secret) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  return null;
}
