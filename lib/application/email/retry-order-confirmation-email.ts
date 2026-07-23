import type { FinalisedOrder } from "@/lib/application/orders/finalise-paid-order";
import { retryPolicy } from "@/lib/config/retry-policy";
import { EmailRetryError } from "./email-retry.errors";

export type RetryableOrderEmail = {
  emailEventId: string;
  dedupeKey: string;
  order: FinalisedOrder;
  attemptCount: number;
};

export type OrderEmailRetryRepository = {
  claimRetryableOrderConfirmation(input: { orderId?: string; emailEventId?: string }): Promise<RetryableOrderEmail | null>;
  markRetrySent(input: { emailEventId: string; resendEmailId?: string | null }): Promise<void>;
  markRetryFailed(input: { emailEventId: string; errorSummary: string; retryable: boolean }): Promise<void>;
};

export async function retryOrderConfirmationEmail(
  input: { orderId?: string; emailEventId?: string },
  dependencies: { repository: OrderEmailRetryRepository }
) {
  const claim = await dependencies.repository.claimRetryableOrderConfirmation(input);
  if (!claim) throw new EmailRetryError("EMAIL_RETRY_NOT_ELIGIBLE", "No retryable order confirmation email was found.");

  if (claim.attemptCount >= retryPolicy.maxApplicationAttempts) {
    await dependencies.repository.markRetryFailed({
      emailEventId: claim.emailEventId,
      errorSummary: "Email retry limit reached.",
      retryable: false
    });
    throw new EmailRetryError("EMAIL_RETRY_LIMIT_REACHED", "Email retry limit reached.");
  }

  try {
    const { sendOrderConfirmationEmail } = await import("@/lib/email/templates/order-confirmation");
    await sendOrderConfirmationEmail({
      orderId: claim.order.orderId,
      emailEventId: claim.emailEventId,
      orderNumber: claim.order.orderNumber,
      email: claim.order.email ?? "",
      customerName: claim.order.customerName,
      createdAt: new Date().toISOString(),
      currency: claim.order.currency,
      subtotal: claim.order.subtotal,
      total: claim.order.total,
      status: "paid",
      shippingAddress: claim.order.shippingAddress,
      billingAddress: claim.order.billingAddress,
      items: claim.order.items.map((item) => ({
        sku: item.sku,
        productName: item.product_name,
        qty: item.qty,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
        attributes: item.attributes
      })),
      vehicle: claim.order.vehicle?.make && claim.order.vehicle.model && claim.order.vehicle.year
        ? {
            make: String(claim.order.vehicle.make),
            model: String(claim.order.vehicle.model),
            year: Number(claim.order.vehicle.year)
          }
        : null
    });
    await dependencies.repository.markRetrySent({ emailEventId: claim.emailEventId });
    return { status: "sent" as const, emailEventId: claim.emailEventId };
  } catch (error) {
    await dependencies.repository.markRetryFailed({
      emailEventId: claim.emailEventId,
      errorSummary: error instanceof Error ? error.message : "Order confirmation retry failed.",
      retryable: true
    });
    throw new EmailRetryError("EMAIL_RETRY_INFRASTRUCTURE", "Order confirmation email retry failed.");
  }
}
