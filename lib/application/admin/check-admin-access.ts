import { AdminConfigurationError, AdminForbiddenError, AdminInfrastructureError, AdminUnauthenticatedError } from "@/lib/domain/admin/admin-access.errors";
import type { AdminAccessContext, AdminAccessResult, AdminSessionUser } from "@/lib/domain/admin/admin-access.types";
import { createClient } from "@/utils/supabase/server";

export function normalizeAdminEmail(email: string | null | undefined) {
  return (email ?? "").trim().toLowerCase();
}

export function parseAdminEmailAllowlist(value: string | null | undefined) {
  const normalized = (value ?? "")
    .split(",")
    .map(normalizeAdminEmail)
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

export function createAdminAccessContext(user: AdminSessionUser, allowlistValue: string | null | undefined): AdminAccessContext {
  const allowlist = parseAdminEmailAllowlist(allowlistValue);
  if (!allowlist.length) throw new AdminConfigurationError();

  const email = normalizeAdminEmail(user.email);
  const authUserId = (user.id ?? "").trim();
  if (!email || !authUserId) throw new AdminUnauthenticatedError();
  if (!allowlist.includes(email)) throw new AdminForbiddenError();

  return { authUserId, email, role: "admin" };
}

export async function checkAdminAccess(): Promise<AdminAccessResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    if (error) {
      if (isSignedOutSupabaseAuthError(error)) throw new AdminUnauthenticatedError();
      throw new AdminInfrastructureError();
    }

    return {
      ok: true,
      context: createAdminAccessContext({ id: user?.id, email: user?.email }, process.env.ADMIN_EMAILS)
    };
  } catch (error) {
    if (error instanceof AdminConfigurationError) return { ok: false, reason: "not_configured" };
    if (error instanceof AdminUnauthenticatedError) return { ok: false, reason: "signed_out" };
    if (error instanceof AdminForbiddenError) return { ok: false, reason: "forbidden" };

    console.error("admin.access_check_failed", {
      operation: "checkAdminAccess",
      reason: error instanceof Error ? error.name : "unknown"
    });
    return { ok: false, reason: "infrastructure" };
  }
}

export function isSignedOutSupabaseAuthError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";

  return (
    name.includes("authsessionmissing") ||
    message.includes("auth session missing") ||
    message.includes("session missing") ||
    message.includes("jwt expired") ||
    message.includes("invalid jwt") ||
    message.includes("refresh token") ||
    code === "session_not_found" ||
    candidate.status === 401
  );
}
