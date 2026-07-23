export type OrderClaimContext = {
  authUserId: string;
  verifiedEmail: string | null;
  emailVerified: boolean;
};

export type OrderClaimResult = {
  claimedCount: number;
  alreadyOwnedCount: number;
  conflictCount: number;
  skippedCount: number;
  claimedOrderIds: string[];
};

export type OrderOwnershipSource = "profile" | "legacy_email";
