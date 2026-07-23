export function normalizeClaimEmail(email: string | null | undefined) {
  return (email ?? "").trim().toLowerCase();
}

export function isUsableClaimEmail(email: string | null | undefined) {
  return normalizeClaimEmail(email).length > 0;
}
