import { checkAdminAccess } from "@/lib/application/admin/check-admin-access";
import { AdminConfigurationError, AdminForbiddenError, AdminInfrastructureError, AdminUnauthenticatedError } from "@/lib/domain/admin/admin-access.errors";
import type { AdminAccessContext } from "@/lib/domain/admin/admin-access.types";

export async function requireAdminAccess(): Promise<AdminAccessContext> {
  const access = await checkAdminAccess();
  if (access.ok) return access.context;

  if (access.reason === "not_configured") throw new AdminConfigurationError();
  if (access.reason === "signed_out") throw new AdminUnauthenticatedError();
  if (access.reason === "forbidden") throw new AdminForbiddenError();
  throw new AdminInfrastructureError();
}
