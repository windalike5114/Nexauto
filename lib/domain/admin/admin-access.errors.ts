import type { AdminAccessFailureReason } from "@/lib/domain/admin/admin-access.types";

export class AdminAccessError extends Error {
  constructor(
    message: string,
    public readonly reason: AdminAccessFailureReason
  ) {
    super(message);
    this.name = "AdminAccessError";
  }
}

export class AdminUnauthenticatedError extends AdminAccessError {
  constructor() {
    super("Admin sign-in is required.", "signed_out");
    this.name = "AdminUnauthenticatedError";
  }
}

export class AdminForbiddenError extends AdminAccessError {
  constructor() {
    super("Admin access denied.", "forbidden");
    this.name = "AdminForbiddenError";
  }
}

export class AdminConfigurationError extends AdminAccessError {
  constructor() {
    super("Admin access is not configured.", "not_configured");
    this.name = "AdminConfigurationError";
  }
}

export class AdminInfrastructureError extends AdminAccessError {
  constructor() {
    super("Admin access could not be verified.", "infrastructure");
    this.name = "AdminInfrastructureError";
  }
}

export function toAdminAccessFailure(error: unknown): AdminAccessFailureReason {
  if (error instanceof AdminAccessError) return error.reason;
  return "infrastructure";
}
