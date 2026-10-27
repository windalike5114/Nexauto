type CheckoutPaymentSession = {
  id: string;
  status: string | null;
  payment_status: string;
};

/** Only a fresh server-side payment-provider response may confirm payment. */
export async function verifyCheckoutPayment<T extends CheckoutPaymentSession>(
  sessionId: unknown,
  retrieveSession: (sessionId: string) => Promise<T>
): Promise<T | null> {
  if (typeof sessionId !== "string" || !/^cs_(?:live|test)_[A-Za-z0-9]{1,240}$/.test(sessionId)) return null;

  try {
    const session = await retrieveSession(sessionId);
    return session.id === sessionId && session.status === "complete" && session.payment_status === "paid"
      ? session
      : null;
  } catch {
    return null;
  }
}
