import { NextResponse } from "next/server";
import { retryOrderConfirmationEmail } from "@/lib/application/email/retry-order-confirmation-email";
import { assertInternalRecoveryAccess } from "@/lib/application/recovery/internal-auth";
import { retryPolicy } from "@/lib/config/retry-policy";
import { writeSystemAuditEvent } from "@/lib/infrastructure/supabase/audit.repository";
import { createSupabaseOrderEmailRetryRepository } from "@/lib/infrastructure/supabase/order-email-retry.repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = assertInternalRecoveryAccess(request);
  if (unauthorized) return unauthorized;

  const body = await safeJson(request);
  const orderIds = Array.isArray(body?.orderIds)
    ? body.orderIds.map(String).filter(Boolean).slice(0, retryPolicy.batchLimit)
    : body?.orderId
      ? [String(body.orderId)]
      : [undefined];

  const results = [];
  for (const orderId of orderIds) {
    try {
      const result = await retryOrderConfirmationEmail({ orderId }, { repository: createSupabaseOrderEmailRetryRepository() });
      await writeSystemAuditEvent({
        eventType: "email_retry",
        entityType: "order",
        entityId: orderId ?? result.emailEventId,
        actorType: "system",
        summary: "Order confirmation email retry executed.",
        metadata: { result: result.status }
      });
      results.push({ orderId: orderId ?? null, status: result.status });
    } catch {
      results.push({ orderId: orderId ?? null, status: "failed" });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}

async function safeJson(request: Request) {
  try {
    return (await request.json()) as { orderId?: unknown; orderIds?: unknown[] };
  } catch {
    return null;
  }
}
