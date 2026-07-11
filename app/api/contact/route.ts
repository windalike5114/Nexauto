import { NextResponse } from "next/server";
import { sendContactEmails } from "@/lib/email/templates/contact";
import { createSupabaseAdminClient } from "@/lib/supabase";

type ContactRequest = {
  name?: string;
  email?: string;
  partOrSku?: string;
  message?: string;
  sourcePage?: string;
  sourceUrl?: string;
  productName?: string;
  productSku?: string;
  company?: string;
};

const attempts = new Map<string, { count: number; resetAt: number }>();
const maxMessageLength = 2000;

export async function POST(request: Request) {
  const ip = getClientIp(request);

  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  let payload: ContactRequest;

  try {
    payload = (await request.json()) as ContactRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (payload.company) {
    return NextResponse.json({ ok: true });
  }

  const name = sanitizeText(payload.name, 120);
  const email = sanitizeEmail(payload.email);
  const partOrSku = sanitizeText(payload.partOrSku, 160);
  const message = sanitizeText(payload.message, maxMessageLength);
  const sourcePage = sanitizeText(payload.sourcePage, 160) || "Website";
  const sourceUrl = sanitizeUrl(payload.sourceUrl);
  const productName = sanitizeText(payload.productName, 160);
  const productSku = sanitizeText(payload.productSku, 120);

  if (!name || !email || !message) {
    return NextResponse.json({ error: "Name, email, and message are required." }, { status: 400 });
  }

  try {
    await saveContactEnquiry({
      name,
      email,
      partOrSku,
      message,
      sourcePage,
      sourceUrl,
      productName,
      productSku
    });

    await sendContactEmails({
      name,
      email,
      partOrSku,
      message,
      sourcePage,
      sourceUrl,
      productName,
      productSku
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "We couldn't send your enquiry. Please try again or email support@nexautoparts.co.nz." },
      { status: 500 }
    );
  }
}

async function saveContactEnquiry(input: {
  name: string;
  email: string;
  partOrSku: string;
  message: string;
  sourcePage: string;
  sourceUrl: string;
  productName: string;
  productSku: string;
}) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return;

  try {
    await supabase.from("contact_enquiries").insert({
      name: input.name,
      email: input.email,
      part_or_sku: input.partOrSku || null,
      message: input.message,
      source_page: input.sourcePage,
      source_url: input.sourceUrl,
      product_name: input.productName || null,
      product_sku: input.productSku || null,
      status: "new"
    });
  } catch {
    // The contact email path should keep working even before the enquiry table is migrated.
  }
}

function isRateLimited(key: string) {
  const now = Date.now();
  const current = attempts.get(key);

  if (!current || current.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return false;
  }

  current.count += 1;
  attempts.set(key, current);
  return current.count > 5;
}

function getClientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function sanitizeEmail(value: unknown) {
  const email = sanitizeText(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  if (/[\r\n]/.test(email)) return "";
  return email;
}

function sanitizeUrl(value: unknown) {
  const fallback = "https://nexautoparts.co.nz";
  const url = sanitizeText(value, 500);
  if (!url) return fallback;

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}
