export class CustomerAddressError extends Error {
  constructor(
    public readonly code:
      | "ADDRESS_VALIDATION_FAILED"
      | "ADDRESS_NOT_FOUND"
      | "ADDRESS_OWNERSHIP_FAILED"
      | "ADDRESS_REPOSITORY_FAILED",
    message: string
  ) {
    super(message);
  }
}
