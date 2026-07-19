import { addressFingerprint, type CustomerAddressInput, type CustomerAddressPatch } from "@/lib/domain/account/customer-address.schema";
import { CustomerAddressError } from "@/lib/domain/account/customer-address.errors";
import type { CustomerAddress, CustomerAddressMutationContext } from "@/lib/domain/account/customer-address.types";
import type { CustomerAddressRepository } from "@/lib/application/account/customer-address-repository";
import { createSupabaseAdminClient } from "@/lib/supabase";

type AddressRow = {
  id: string;
  customer_profile_id: string;
  label: string | null;
  recipient_name: string;
  company: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  suburb: string | null;
  city: string;
  region: string | null;
  postcode: string | null;
  country: string;
  is_default_shipping: boolean;
  created_at: string;
  updated_at: string;
};

export function createSupabaseAccountAddressRepository(): CustomerAddressRepository {
  return {
    async list(context) {
      const { data, error } = await getAdmin()
        .from("customer_addresses")
        .select(selectColumns)
        .eq("customer_profile_id", context.customerProfileId)
        .order("is_default_shipping", { ascending: false })
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw repositoryError(error);
      return ((data ?? []) as AddressRow[]).map(mapAddress);
    },

    async create(context, input) {
      const address = await rpcCreateAddress(context, input, null);
      await audit("customer_address_created", context, address.id, { default: address.isDefaultShipping });
      return address;
    },

    async update(context, addressId, input) {
      const patch = toPatch(input);
      let address: CustomerAddress | null = null;

      if (Object.keys(patch).length) {
        const { data, error } = await getAdmin()
          .from("customer_addresses")
          .update(patch)
          .eq("id", addressId)
          .eq("customer_profile_id", context.customerProfileId)
          .select(selectColumns)
          .maybeSingle();
        if (error) throw repositoryError(error);
        if (!data) throw new CustomerAddressError("ADDRESS_NOT_FOUND", "Address was not found.");
        address = mapAddress(data as AddressRow);
      }

      if (input.isDefaultShipping) {
        address = await this.setDefault(context, addressId);
      }

      if (!address) {
        const addresses = await this.list(context);
        address = addresses.find((entry) => entry.id === addressId) ?? null;
      }

      if (!address) throw new CustomerAddressError("ADDRESS_NOT_FOUND", "Address was not found.");
      await audit("customer_address_updated", context, addressId, { default: address.isDefaultShipping });
      return address;
    },

    async delete(context, addressId) {
      const { data, error } = await getAdmin().rpc("delete_customer_address", {
        p_auth_user_id: context.authUserId,
        p_address_id: addressId
      });
      if (error) throw repositoryError(error);
      const row = Array.isArray(data) ? data[0] : data;
      await audit("customer_address_deleted", context, addressId, {
        replacementDefaultAddressId: row?.replacement_default_address_id ?? null
      });
      return {
        deletedAddressId: row?.deleted_address_id ?? addressId,
        replacementDefaultAddressId: row?.replacement_default_address_id ?? null
      };
    },

    async setDefault(context, addressId) {
      const { data, error } = await getAdmin().rpc("set_default_customer_address", {
        p_auth_user_id: context.authUserId,
        p_address_id: addressId
      });
      if (error) throw repositoryError(error);
      if (!data) throw new CustomerAddressError("ADDRESS_NOT_FOUND", "Address was not found.");
      const address = mapAddress(data as AddressRow);
      await audit("customer_address_default_changed", context, addressId, {});
      return address;
    },

    async importLegacy(context, inputs) {
      const current = await this.list(context);
      const existing = new Set(current.map(addressFingerprintFromAddress));
      const imported: CustomerAddress[] = [];
      let skipped = 0;

      for (const input of inputs) {
        const fingerprint = addressFingerprint(input);
        if (existing.has(fingerprint)) {
          skipped += 1;
          continue;
        }

        try {
          const address = await rpcCreateAddress(context, input, fingerprint);
          imported.push(address);
          existing.add(fingerprint);
        } catch (error) {
          if (isUniqueImportConflict(error)) {
            skipped += 1;
            existing.add(fingerprint);
            continue;
          }
          throw error;
        }
      }

      const addresses = await this.list(context);
      await audit("customer_address_legacy_import_completed", context, null, {
        imported: imported.length,
        skipped
      });

      return {
        imported: imported.length,
        skipped,
        invalid: 0,
        addresses
      };
    }
  };
}

const selectColumns = "id,customer_profile_id,label,recipient_name,company,phone,line1,line2,suburb,city,region,postcode,country,is_default_shipping,created_at,updated_at";

async function rpcCreateAddress(context: CustomerAddressMutationContext, input: CustomerAddressInput, legacyImportFingerprint: string | null) {
  const { data, error } = await getAdmin().rpc("create_customer_address", {
    p_auth_user_id: context.authUserId,
    p_label: input.label,
    p_recipient_name: input.recipientName,
    p_company: input.company,
    p_phone: input.phone,
    p_line1: input.line1,
    p_line2: input.line2,
    p_suburb: input.suburb,
    p_city: input.city,
    p_region: input.region,
    p_postcode: input.postcode,
    p_country: input.country,
    p_is_default_shipping: input.isDefaultShipping,
    p_legacy_import_fingerprint: legacyImportFingerprint
  });
  if (error) throw repositoryError(error);
  if (!data) throw new CustomerAddressError("ADDRESS_REPOSITORY_FAILED", "Address could not be saved.");
  return mapAddress(data as AddressRow);
}

function toPatch(input: CustomerAddressPatch) {
  const patch: Record<string, unknown> = {};
  if ("label" in input) patch.label = input.label;
  if ("recipientName" in input) patch.recipient_name = input.recipientName;
  if ("company" in input) patch.company = input.company;
  if ("phone" in input) patch.phone = input.phone;
  if ("line1" in input) patch.line1 = input.line1;
  if ("line2" in input) patch.line2 = input.line2;
  if ("suburb" in input) patch.suburb = input.suburb;
  if ("city" in input) patch.city = input.city;
  if ("region" in input) patch.region = input.region;
  if ("postcode" in input) patch.postcode = input.postcode;
  if ("country" in input) patch.country = input.country;
  return patch;
}

function mapAddress(row: AddressRow): CustomerAddress {
  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    label: row.label,
    recipientName: row.recipient_name,
    company: row.company,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    suburb: row.suburb,
    city: row.city,
    region: row.region,
    postcode: row.postcode ?? "",
    country: "NZ",
    isDefaultShipping: row.is_default_shipping,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function addressFingerprintFromAddress(address: CustomerAddress) {
  return addressFingerprint({
    label: address.label ?? "Home",
    recipientName: address.recipientName,
    company: address.company,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    suburb: address.suburb,
    city: address.city,
    region: address.region,
    postcode: address.postcode,
    country: address.country,
    isDefaultShipping: address.isDefaultShipping
  });
}

function isUniqueImportConflict(error: unknown) {
  return error instanceof CustomerAddressError && error.message.includes("duplicate");
}

function repositoryError(error: { code?: string; message?: string }) {
  if (error.message?.includes("address_not_found")) return new CustomerAddressError("ADDRESS_NOT_FOUND", "Address was not found.");
  if (error.message?.includes("customer_profile_not_found")) return new CustomerAddressError("ADDRESS_OWNERSHIP_FAILED", "Customer profile was not found.");
  if (error.code === "23505") return new CustomerAddressError("ADDRESS_REPOSITORY_FAILED", "Address duplicate detected.");
  return new CustomerAddressError("ADDRESS_REPOSITORY_FAILED", "Address request could not be completed.");
}

async function audit(eventType: string, context: CustomerAddressMutationContext, addressId: string | null, metadata: Record<string, unknown>) {
  void eventType;
  void context;
  void addressId;
  void metadata;
}

function getAdmin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new CustomerAddressError("ADDRESS_REPOSITORY_FAILED", "Address service is not configured.");
  return supabase;
}
