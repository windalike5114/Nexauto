import { createSupabaseServerClient } from "@/lib/supabase";
import type { WiperRearAddon, WiperSet } from "@/lib/types";

type WiperSetRow = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  set_type: "front_pair" | "front_rear_set";
  driver_length_in: string | number;
  passenger_length_in: string | number;
  rear_length_in: string | number | null;
  price: string | number;
  compare_at_price: string | number | null;
  active: boolean;
  visibility_status: "internal" | "public" | "archived";
  content_status: "generated" | "review" | "approved" | "rejected";
  commerce_status: "catalog_only" | "enquiry" | "active" | "unavailable" | "discontinued";
  checkout_enabled: boolean;
};

type WiperRearAddonRow = {
  id: string;
  slug: string;
  name: string;
  rear_length_in: string | number;
  price: string | number;
  active: boolean;
};

const APPROVED_FRONT_WIPER_LENGTHS = new Set([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 30]);
const APPROVED_REAR_WIPER_LENGTHS = new Set([8, 10, 11, 12, 13, 14, 15, 16]);

function getSupabaseOrThrow() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase is not configured for wiper commerce.");
  }

  return supabase;
}

export function buildWiperFrontPairSku(driverLengthIn: number, passengerLengthIn: number) {
  const shortLength = Math.min(driverLengthIn, passengerLengthIn);
  const longLength = Math.max(driverLengthIn, passengerLengthIn);

  return `WPFP${formatSkuLength(shortLength)}${formatSkuLength(longLength)}`;
}

export async function getWiperSetByLengths(driverLengthIn: number, passengerLengthIn: number) {
  if (!isApprovedFrontPair(driverLengthIn, passengerLengthIn)) return null;
  const supabase = getSupabaseOrThrow();
  const longLength = Math.max(driverLengthIn, passengerLengthIn);
  const shortLength = Math.min(driverLengthIn, passengerLengthIn);

  const { data, error } = await supabase
    .from("wiper_sets")
    .select("id,sku,slug,name,set_type,driver_length_in,passenger_length_in,rear_length_in,price,compare_at_price,active,visibility_status,content_status,commerce_status,checkout_enabled")
    .eq("driver_length_in", longLength)
    .eq("passenger_length_in", shortLength)
    .eq("set_type", "front_pair")
    .eq("active", true)
    .eq("visibility_status", "public")
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  const wiperSet = mapWiperSet(data as WiperSetRow);
  return isApprovedWiperSet(wiperSet) ? wiperSet : null;
}

export async function getWiperSetBySku(sku: string) {
  const lengths = parseWiperFrontPairSku(sku);
  if (!lengths) return null;
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("wiper_sets")
    .select("id,sku,slug,name,set_type,driver_length_in,passenger_length_in,rear_length_in,price,compare_at_price,active,visibility_status,content_status,commerce_status,checkout_enabled")
    .eq("driver_length_in", lengths.longLength)
    .eq("passenger_length_in", lengths.shortLength)
    .eq("set_type", "front_pair")
    .eq("active", true)
    .eq("visibility_status", "public")
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  const wiperSet = mapWiperSet(data as WiperSetRow);
  return isApprovedWiperSet(wiperSet) ? wiperSet : null;
}

export async function getWiperSetsByIds(ids: string[]) {
  if (ids.length === 0) return [];

  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("wiper_sets")
    .select("id,sku,slug,name,set_type,driver_length_in,passenger_length_in,rear_length_in,price,compare_at_price,active,visibility_status,content_status,commerce_status,checkout_enabled")
    .in("id", ids)
    .eq("active", true)
    .eq("visibility_status", "public")
    .eq("content_status", "approved")
    .eq("commerce_status", "active")
    .eq("checkout_enabled", true);

  if (error) throw error;
  return (data as WiperSetRow[]).map(mapWiperSet).filter(isApprovedWiperSet);
}

export async function getWiperRearAddonByLength(rearLengthIn: number | null) {
  if (!rearLengthIn || !APPROVED_REAR_WIPER_LENGTHS.has(rearLengthIn)) return null;

  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("wiper_rear_addons")
    .select("id,slug,name,rear_length_in,price,active")
    .eq("rear_length_in", rearLengthIn)
    .eq("active", true)
    .eq("visibility_status", "public")
    .eq("content_status", "approved")
    .eq("commerce_status", "active")
    .eq("checkout_enabled", true)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  const rearAddon = mapWiperRearAddon(data as WiperRearAddonRow);
  return APPROVED_REAR_WIPER_LENGTHS.has(rearAddon.rearLengthIn) ? rearAddon : null;
}

export async function getWiperRearAddonById(id: string | null | undefined) {
  if (!id) return null;

  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("wiper_rear_addons")
    .select("id,slug,name,rear_length_in,price,active")
    .eq("id", id)
    .eq("active", true)
    .eq("visibility_status", "public")
    .eq("content_status", "approved")
    .eq("commerce_status", "active")
    .eq("checkout_enabled", true)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  const rearAddon = mapWiperRearAddon(data as WiperRearAddonRow);
  return APPROVED_REAR_WIPER_LENGTHS.has(rearAddon.rearLengthIn) ? rearAddon : null;
}

export async function getWiperRearAddonsByIds(ids: string[]) {
  if (ids.length === 0) return [];

  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("wiper_rear_addons")
    .select("id,slug,name,rear_length_in,price,active")
    .in("id", ids)
    .eq("active", true)
    .eq("visibility_status", "public")
    .eq("content_status", "approved")
    .eq("commerce_status", "active")
    .eq("checkout_enabled", true);

  if (error) throw error;
  return (data as WiperRearAddonRow[]).map(mapWiperRearAddon).filter((item) => APPROVED_REAR_WIPER_LENGTHS.has(item.rearLengthIn));
}

export async function listWiperSets() {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("wiper_sets")
    .select("id,sku,slug,name,set_type,driver_length_in,passenger_length_in,rear_length_in,price,compare_at_price,active,visibility_status,content_status,commerce_status,checkout_enabled")
    .eq("active", true)
    .eq("visibility_status", "public")
    .order("driver_length_in")
    .order("passenger_length_in");

  if (error) throw error;
  return (data as WiperSetRow[]).map(mapWiperSet).filter(isApprovedWiperSet);
}

function isApprovedFrontPair(driverLengthIn: number, passengerLengthIn: number) {
  return APPROVED_FRONT_WIPER_LENGTHS.has(driverLengthIn) && APPROVED_FRONT_WIPER_LENGTHS.has(passengerLengthIn);
}

function isApprovedWiperSet(wiperSet: WiperSet) {
  return isApprovedFrontPair(wiperSet.driverLengthIn, wiperSet.passengerLengthIn)
    && (wiperSet.rearLengthIn === null || APPROVED_REAR_WIPER_LENGTHS.has(wiperSet.rearLengthIn));
}

function mapWiperSet(row: WiperSetRow): WiperSet {
  const purchasable = row.active
    && row.visibility_status === "public"
    && row.content_status === "approved"
    && row.commerce_status === "active"
    && row.checkout_enabled;
  return {
    id: row.id,
    sku: buildWiperFrontPairSku(Number(row.driver_length_in), Number(row.passenger_length_in)),
    slug: row.slug,
    name: row.name,
    setType: row.set_type,
    driverLengthIn: Number(row.driver_length_in),
    passengerLengthIn: Number(row.passenger_length_in),
    rearLengthIn: row.rear_length_in === null ? null : Number(row.rear_length_in),
    price: Number(row.price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    active: row.active,
    commerceStatus: row.commerce_status,
    checkoutEnabled: row.checkout_enabled,
    purchasable
  };
}

function parseWiperFrontPairSku(value: string) {
  const match = value.toUpperCase().match(/^WPFP(\d{2})(\d{2})$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!isApprovedFrontPair(first, second)) return null;
  return { shortLength: Math.min(first, second), longLength: Math.max(first, second) };
}

function mapWiperRearAddon(row: WiperRearAddonRow): WiperRearAddon {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    rearLengthIn: Number(row.rear_length_in),
    price: Number(row.price),
    active: row.active
  };
}

function formatSkuLength(length: number) {
  return Number.isInteger(length) ? String(length) : String(length).replace(".", "P");
}
