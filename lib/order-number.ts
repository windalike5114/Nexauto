import type { SupabaseClient } from "@supabase/supabase-js";

export function formatFallbackOrderNumber(orderId: string) {
  const digits = orderId.replace(/\D/g, "").slice(-5).padStart(5, "0");
  return `NEX${digits}`;
}

export async function allocateOrderNumber(supabase: SupabaseClient, orderId: string) {
  const { data, error } = await supabase.rpc("allocate_nex_order_number", {
    order_uuid: orderId
  });

  if (error || typeof data !== "string") {
    return formatFallbackOrderNumber(orderId);
  }

  return data;
}

export function getOrderNumberFromSnapshot(orderId: string, snapshot: unknown) {
  if (snapshot && typeof snapshot === "object" && "order_number" in snapshot) {
    const value = (snapshot as { order_number?: unknown }).order_number;
    if (typeof value === "string" && value.trim()) return value;
  }

  return formatFallbackOrderNumber(orderId);
}
