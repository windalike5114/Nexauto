export type AdminRole = "admin";

export type AdminAccessContext = {
  authUserId: string;
  email: string;
  role: AdminRole;
};

export type AdminAccessFailureReason = "signed_out" | "forbidden" | "not_configured" | "infrastructure";

export type AdminAccessResult =
  | { ok: true; context: AdminAccessContext }
  | { ok: false; reason: AdminAccessFailureReason; email?: string };

export type AdminSessionUser = {
  id?: string | null;
  email?: string | null;
};
