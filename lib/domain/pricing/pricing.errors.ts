export class PricingError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "PricingError";
  }
}

export function safePricingErrorMessage() {
  return "Order pricing could not be calculated.";
}
