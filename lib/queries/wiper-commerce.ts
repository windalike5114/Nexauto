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
};

type WiperRearAddonRow = {
  id: string;
  slug: string;
  name: string;
  rear_length_in: string | number;
  price: string | number;
  active: boolean;
};

function getSupabaseOrThrow() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase is not configured for wiper commerce.");
  }

  return supabase;
}

export function buildWiperFrontPairSku(driverLengthIn: number, passengerLengthIn: number) {
  const longLength = Math.max(driverLengthIn, passengerLengthIn);
  const shortLength = Math.min(driverLengthIn, passengerLengthIn);

  return `WPFP${formatSkuLength(longLength)}${formatSkuLength(shortLength)}`;
}

export async function getWiperSetByLengths(driverLengthIn: number, passengerLengthIn: number) {
  const supabase = getSupabaseOrThrow();
  const longLength = Math.max(driverLengthIn, passengerLengthIn);
  const shortLength = Math.min(driverLengthIn, passengerLengthIn);

  if (longLength === shortLength) return null;

  const { data, error } = await supabase
    .from("wiper_sets")
    .select("id,sku,slug,name,set_type,driver_length_in,passenger_length_in,rear_length_in,price,compare_at_price,active")
    .eq("driver_length_in", longLength)
    .eq("passenger_length_in", shortLength)
    .eq("set_type", "front_pair")
    .eq("active", true)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return mapWiperSet(data as WiperSetRow);
}

export async function getWiperRearAddonByLength(rearLengthIn: number | null) {
  if (!rearLengthIn) return null;

  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("wiper_rear_addons")
    .select("id,slug,name,rear_length_in,price,active")
    .eq("rear_length_in", rearLengthIn)
    .eq("active", true)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return mapWiperRearAddon(data as WiperRearAddonRow);
}

export async function listWiperSets() {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("wiper_sets")
    .select("id,sku,slug,name,set_type,driver_length_in,passenger_length_in,rear_length_in,price,compare_at_price,active")
    .eq("active", true)
    .order("driver_length_in")
    .order("passenger_length_in");

  if (error) throw error;
  return (data as WiperSetRow[]).map(mapWiperSet);
}

function mapWiperSet(row: WiperSetRow): WiperSet {
  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    setType: row.set_type,
    driverLengthIn: Number(row.driver_length_in),
    passengerLengthIn: Number(row.passenger_length_in),
    rearLengthIn: row.rear_length_in === null ? null : Number(row.rear_length_in),
    price: Number(row.price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    active: row.active
  };
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
