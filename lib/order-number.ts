import type { SupabaseClient } from "@supabase/supabase-js";

export async function allocateOrderNumber(supabase: SupabaseClient, orderId: string) {
  const { data, error } = await supabase.rpc("allocate_nex_order_number", {
    order_uuid: orderId
  });

  if (error || typeof data !== "string" || !data.trim()) {
    throw new Error(error?.message ?? "Could not allocate order number.");
  }

  return data;
}

export function getOrderNumberFromSnapshot(snapshot: unknown) {
  if (snapshot && typeof snapshot === "object" && "order_number" in snapshot) {
    const value = (snapshot as { order_number?: unknown }).order_number;
    if (typeof value === "string" && value.trim()) return value;
  }

  return null;
}
