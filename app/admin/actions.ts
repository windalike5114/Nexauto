"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { requireAdminAccess } from "@/lib/queries/admin";

export async function updateFulfillmentAction(formData: FormData) {
  await requireAdminAccess();
  const supabase = getAdminOrThrow();
  const id = requiredString(formData, "fulfillmentId");
  const { error } = await supabase
    .from("order_wiper_fulfillment")
    .update({
      driver_connector: optionalString(formData, "driverConnector"),
      passenger_connector: optionalString(formData, "passengerConnector"),
      rear_connector: optionalString(formData, "rearConnector"),
      connector_status: requiredString(formData, "connectorStatus"),
      admin_note: optionalString(formData, "adminNote"),
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) throw error;
  revalidatePath("/admin");
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
  revalidatePath("/admin");
}

export async function updateWiperSetAction(formData: FormData) {
  await requireAdminAccess();
  const supabase = getAdminOrThrow();
  const id = requiredString(formData, "wiperSetId");
  const price = Number(requiredString(formData, "price"));

  if (!Number.isFinite(price)) {
    throw new Error("Price must be a valid number.");
  }

  const { error } = await supabase
    .from("wiper_sets")
    .update({
      price,
      active: formData.get("active") === "on",
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) throw error;
  revalidatePath("/admin");
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
  revalidatePath("/admin");
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
  revalidatePath("/admin");
  revalidatePath("/shop");
  revalidatePath("/");
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
