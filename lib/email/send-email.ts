import "server-only";
import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { emailAddresses } from "./config";

export type EmailType =
  | "contact_internal"
  | "contact_confirmation"
  | "order_confirmation"
  | "payment_confirmation"
  | "payment_failed"
  | "shipping_confirmation"
  | "pickup_ready"
  | "cancellation_confirmation"
  | "refund_confirmation"
  | "return_confirmation"
  | "warranty_confirmation"
  | "verification"
  | "password_reset"
  | "password_changed";

export type SendEmailInput = {
  type: EmailType;
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  orderId?: string;
  customerId?: string;
};

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendEmail(input: SendEmailInput) {
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const eventId = await logEmailEvent({
    type: input.type,
    recipient: recipients.join(","),
    subject: input.subject,
    orderId: input.orderId,
    customerId: input.customerId,
    status: "queued"
  });

  if (!resend) {
    await updateEmailEvent(eventId, {
      status: "failed",
      errorCode: "RESEND_API_KEY missing"
    });
    throw new Error("Resend is not configured. Add RESEND_API_KEY.");
  }

  try {
    const result = await resend.emails.send({
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo ?? emailAddresses.support
    });

    if (result.error) {
      await updateEmailEvent(eventId, {
        status: "failed",
        errorCode: result.error.message
      });
      throw new Error(result.error.message);
    }

    await updateEmailEvent(eventId, {
      status: "sent",
      resendEmailId: result.data?.id ?? null,
      sentAt: new Date().toISOString()
    });

    return result.data;
  } catch (error) {
    await updateEmailEvent(eventId, {
      status: "failed",
      errorCode: error instanceof Error ? error.message : "Unknown email error"
    });
    throw error;
  }
}

async function logEmailEvent(input: {
  type: EmailType;
  recipient: string;
  subject: string;
  status: string;
  orderId?: string;
  customerId?: string;
}) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return null;

  try {
    const { data } = await supabase
      .from("email_events")
      .insert({
        type: input.type,
        recipient: input.recipient,
        subject: input.subject,
        status: input.status,
        order_id: input.orderId ?? null,
        customer_id: input.customerId ?? null
      })
      .select("id")
      .single();

    return data?.id ?? null;
  } catch {
    return null;
  }
}

export async function updateEmailEvent(
  id: string | null,
  patch: {
    status?: string;
    resendEmailId?: string | null;
    errorCode?: string | null;
    sentAt?: string;
  }
) {
  if (!id) return;

  const supabase = createSupabaseAdminClient();
  if (!supabase) return;

  try {
    await supabase
      .from("email_events")
      .update({
        status: patch.status,
        resend_email_id: patch.resendEmailId,
        error_code: patch.errorCode,
        sent_at: patch.sentAt
      })
      .eq("id", id);
  } catch {
    // Email delivery should not fail user checkout/contact flows because logging is unavailable.
  }
}

export async function updateEmailEventByResendId(
  resendEmailId: string,
  patch: {
    status?: string;
    errorCode?: string | null;
  }
) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return;

  try {
    await supabase
      .from("email_events")
      .update({
        status: patch.status,
        error_code: patch.errorCode,
        updated_at: new Date().toISOString()
      })
      .eq("resend_email_id", resendEmailId);
  } catch {
    // Webhook delivery should not expose internal logging failures.
  }
}
