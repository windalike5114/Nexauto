"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { retryOrderConfirmationEmail } from "@/lib/application/email/retry-order-confirmation-email";
import { retryStripeWebhookEvent } from "@/lib/application/webhooks/retry-stripe-webhook-event";
import { createSupabaseOrderEmailService } from "@/lib/infrastructure/supabase/order-email.repository";
import { createSupabaseOrderEmailRetryRepository } from "@/lib/infrastructure/supabase/order-email-retry.repository";
import { createSupabaseOrderFinalisationRepository } from "@/lib/infrastructure/supabase/order-finalisation.repository";
import { createSupabaseStripeWebhookEventRepository } from "@/lib/infrastructure/supabase/stripe-webhook-event.repository";
import { createSupabaseWebhookRecoveryRepository } from "@/lib/infrastructure/supabase/webhook-recovery.repository";
import { createWebhookCustomerEnrichmentService } from "@/lib/infrastructure/supabase/webhook-customer-enrichment";
import { writeSystemAuditEvent } from "@/lib/infrastructure/supabase/audit.repository";
import { createStripeEventRetrieval } from "@/lib/infrastructure/stripe/event-retrieval";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { requireAdminAccess } from "@/lib/queries/admin";

const fulfilmentStatuses = new Set(["pending", "selected", "packed", "fulfilled", "issue"]);

export async function updateFulfillmentAction(formData: FormData) {
  const access = await requireAdminAccess();
  const supabase = getAdminOrThrow();
  const id = requiredString(formData, "fulfillmentId");
  const connectorStatus = requiredString(formData, "connectorStatus");

  if (!fulfilmentStatuses.has(connectorStatus)) {
    throw new Error("Connector status is not allowed.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("order_wiper_fulfillment")
    .select("id,order_id,connector_status")
    .eq("id", id)
    .maybeSingle();

  if (existingError) throw existingError;
  if (!existing?.order_id) throw new Error("Fulfilment row was not found.");

  const { error } = await supabase
    .from("order_wiper_fulfillment")
    .update({
      driver_connector: optionalString(formData, "driverConnector"),
      passenger_connector: optionalString(formData, "passengerConnector"),
      rear_connector: optionalString(formData, "rearConnector"),
      connector_status: connectorStatus,
      admin_note: optionalString(formData, "adminNote"),
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) throw error;
  await writeSystemAuditEvent({
    eventType: "admin_fulfilment_updated",
    entityType: "order",
    entityId: existing.order_id,
    actorType: "admin",
    actorId: access.context.authUserId,
    summary: "Admin updated wiper fulfilment connector details.",
    metadata: {
      fulfilmentId: id,
      previousStatus: existing.connector_status,
      nextStatus: connectorStatus
    }
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/orders/${existing.order_id}`);
}

export async function retryOrderEmailAction(formData: FormData) {
  const access = await requireAdminAccess();
  const orderId = requiredString(formData, "orderId");
  const emailEventId = optionalString(formData, "emailEventId");
  const result = await retryOrderConfirmationEmail({ orderId, emailEventId: emailEventId ?? undefined }, { repository: createSupabaseOrderEmailRetryRepository() });

  await writeSystemAuditEvent({
    eventType: "admin_email_retry",
    entityType: "order",
    entityId: orderId,
    actorType: "admin",
    actorId: access.context.authUserId,
    summary: "Admin retried an order confirmation email.",
    metadata: {
      emailEventId: result.emailEventId,
      result: result.status
    }
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/orders/${orderId}`);
}

export async function retryStripeWebhookAction(formData: FormData) {
  const access = await requireAdminAccess();
  const orderId = requiredString(formData, "orderId");
  const stripeEventId = requiredString(formData, "stripeEventId");
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const result = await retryStripeWebhookEvent(
    { stripeEventId },
    {
      recovery: createSupabaseWebhookRecoveryRepository(),
      stripeEvents: createStripeEventRetrieval(stripe),
      events: createSupabaseStripeWebhookEventRepository(),
      orders: createSupabaseOrderFinalisationRepository(),
      customers: createWebhookCustomerEnrichmentService(),
      emails: createSupabaseOrderEmailService(),
      logger: console
    }
  );

  await writeSystemAuditEvent({
    eventType: "admin_webhook_retry",
    entityType: "order",
    entityId: orderId,
    actorType: "admin",
    actorId: access.context.authUserId,
    summary: "Admin retried a Stripe webhook event.",
    metadata: {
      stripeEventId,
      result: result.status,
      resultOrderId: result.orderId ?? null
    }
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/orders/${orderId}`);
}

export async function updateVariantAction(formData: FormData) {
  await requireAdminAccess();
  const supabase = getAdminOrThrow();
  const id = requiredString(formData, "variantId");
  const stock = Number(requiredString(formData, "stock"));
  const price = Number(requiredString(formData, "price"));

  if (!Number.isFinite(stock) || !Number.isFinite(price)) {
    throw new Error("Stock and price must be valid numbers.");
  }

  const { error } = await supabase
    .from("product_variants")
    .update({
      stock,
      price,
      active: formData.get("active") === "on",
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) throw error;

  const { data: variantRow, error: variantRowError } = await supabase
    .from("product_variants")
    .select("product_id")
    .eq("id", id)
    .maybeSingle();

  if (variantRowError) throw variantRowError;
  if (!variantRow?.product_id) throw new Error("Updated variant could not be reloaded.");

  const { data: productRow, error: productRowError } = await supabase
    .from("products")
    .select("slug")
    .eq("id", variantRow.product_id)
    .maybeSingle();

  if (productRowError) throw productRowError;

  const { data: activeVariants, error: activeVariantsError } = await supabase
    .from("product_variants")
    .select("price")
    .eq("product_id", variantRow.product_id)
    .eq("active", true);

  if (activeVariantsError) throw activeVariantsError;

  const displayPrice = ((activeVariants ?? []) as Array<{ price: string | number }>)
    .map((entry) => Number(entry.price))
    .filter((entry) => Number.isFinite(entry))
    .sort((a, b) => a - b)[0] ?? price;

  const { error: syncProductError } = await supabase
    .from("products")
    .update({
      price: displayPrice,
      updated_at: new Date().toISOString()
    })
    .eq("id", variantRow.product_id);

  if (syncProductError) throw syncProductError;

  revalidateCatalogViews(productRow?.slug ?? null);
  redirect(buildAdminSuccessUrl("products", "variant") as never);
}

export async function updateWiperSetAction(formData: FormData) {
  await requireAdminAccess();
  const supabase = getAdminOrThrow();
  const id = requiredString(formData, "wiperSetId");
  const sku = requiredString(formData, "sku");
  const price = Number(requiredString(formData, "price"));
  const compareAtPriceValue = optionalString(formData, "compareAtPrice");
  const compareAtPrice = compareAtPriceValue ? Number(compareAtPriceValue) : null;

  if (!Number.isFinite(price) || (compareAtPrice !== null && !Number.isFinite(compareAtPrice))) {
    throw new Error("Price must be a valid number.");
  }

  const { error } = await supabase
    .from("wiper_sets")
    .update({
      price,
      compare_at_price: compareAtPrice,
      active: formData.get("active") === "on",
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) throw error;
  revalidateCatalogViews();
  revalidatePath(`/wipers/${sku}`);
  redirect(buildAdminSuccessUrl("products", "wiper-set") as never);
}

export async function updateRearAddonAction(formData: FormData) {
  await requireAdminAccess();
  const supabase = getAdminOrThrow();
  const id = requiredString(formData, "rearAddonId");
  const price = Number(requiredString(formData, "price"));

  if (!Number.isFinite(price)) {
    throw new Error("Price must be a valid number.");
  }

  const { error } = await supabase
    .from("wiper_rear_addons")
    .update({
      price,
      active: formData.get("active") === "on",
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) throw error;
  revalidateCatalogViews();
  redirect(buildAdminSuccessUrl("products", "rear-addon") as never);
}

export async function updateProductContentAction(formData: FormData) {
  await requireAdminAccess();
  const supabase = getAdminOrThrow();
  const id = requiredString(formData, "productId");
  const price = Number(requiredString(formData, "price"));
  const detailSections = parseDetailSections(optionalString(formData, "detailSections"));

  if (!Number.isFinite(price)) {
    throw new Error("Price must be a valid number.");
  }

  const { error } = await supabase
    .from("products")
    .update({
      name: requiredString(formData, "name"),
      price,
      description: optionalString(formData, "description") ?? "",
      detail_sections: detailSections,
      video_url: optionalString(formData, "videoUrl"),
      active: formData.get("active") === "on",
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) throw error;

  const { data: productRow, error: productRowError } = await supabase
    .from("products")
    .select("slug")
    .eq("id", id)
    .maybeSingle();

  if (productRowError) throw productRowError;

  const { error: variantsError } = await supabase
    .from("product_variants")
    .update({
      price,
      updated_at: new Date().toISOString()
    })
    .eq("product_id", id);

  if (variantsError) throw variantsError;

  revalidateCatalogViews(productRow?.slug ?? null);
  redirect(buildAdminSuccessUrl("content", "product-content") as never);
}

function getAdminOrThrow() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin actions.");
  return supabase;
}

function requiredString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required.`);
  return value.trim();
}

function optionalString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function revalidateCatalogViews(productSlug?: string | null) {
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/shop");
  revalidatePath("/promotion");

  if (productSlug) {
    revalidatePath(`/products/${productSlug}`);
  }
}

function buildAdminSuccessUrl(tab: "products" | "content", saved: "variant" | "wiper-set" | "rear-addon" | "product-content") {
  return `/admin?tab=${tab}&saved=${saved}`;
}

function parseDetailSections(value: string | null) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) throw new Error("detailSections must be an array.");

    return parsed.map((entry) => {
      if (!entry || typeof entry !== "object") throw new Error("Each detail section must be an object.");
      const title = "title" in entry ? String((entry as { title: unknown }).title ?? "").trim() : "";
      const body = "body" in entry ? String((entry as { body: unknown }).body ?? "").trim() : "";
      if (!title || !body) throw new Error("Each detail section needs title and body.");
      return { title, body };
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Detail sections JSON is invalid.");
  }
}
