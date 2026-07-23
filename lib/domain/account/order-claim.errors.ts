export type OrderClaimErrorCode =
  | "ORDER_CLAIM_EMAIL_NOT_VERIFIED"
  | "ORDER_CLAIM_PROFILE_MISSING"
  | "ORDER_CLAIM_EMAIL_MISMATCH"
  | "ORDER_CLAIM_DUPLICATE_PROFILE"
  | "ORDER_CLAIM_CONFLICT"
  | "ORDER_CLAIM_REPOSITORY_FAILED";

export class OrderClaimError extends Error {
  constructor(
    public readonly code: OrderClaimErrorCode,
    message: string,
    public readonly safeMessage = "Order history could not be linked right now."
  ) {
    super(message);
    this.name = "OrderClaimError";
  }
}

export function isOrderClaimError(error: unknown): error is OrderClaimError {
  return error instanceof OrderClaimError;
}
