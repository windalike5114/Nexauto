export class EmailRetryError extends Error {
  constructor(
    public readonly code:
      | "EMAIL_RETRY_NOT_FOUND"
      | "EMAIL_RETRY_NOT_ELIGIBLE"
      | "EMAIL_RETRY_LIMIT_REACHED"
      | "EMAIL_RETRY_INFRASTRUCTURE",
    message: string
  ) {
    super(message);
  }
}
