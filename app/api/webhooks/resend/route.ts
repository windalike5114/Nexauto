import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { updateEmailEventByResendId } from "@/lib/email/send-email";

type ResendWebhookPayload = {
  type?: string;
  data?: {
    email_id?: string;
    id?: string;
    to?: string[];
    subject?: string;
    error?: {
      message?: string;
      name?: string;
    };
  };
};

const statusByEvent: Record<string, string> = {
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.failed": "failed",
  "email.complained": "complained"
};

export async function POST(request: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json({ error: "Resend webhook is not configured." }, { status: 500 });
  }

  const body = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? ""
  };

  let payload: ResendWebhookPayload;

  try {
    payload = new Webhook(webhookSecret).verify(body, headers) as ResendWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid Resend webhook signature." }, { status: 400 });
  }

  const status = payload.type ? statusByEvent[payload.type] : null;
  const resendEmailId = payload.data?.email_id ?? payload.data?.id;

  if (status && resendEmailId) {
    await updateEmailEventByResendId(resendEmailId, {
      status,
      errorCode: payload.data?.error?.message ?? payload.data?.error?.name ?? null
    });
  }

  return NextResponse.json({ received: true });
}
