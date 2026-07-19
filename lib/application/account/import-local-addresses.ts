import {
  addressFingerprint,
  LegacyCustomerAddressImportSchema,
  normalizeLegacyAddress,
  type CustomerAddressInput
} from "@/lib/domain/account/customer-address.schema";
import type { CustomerAddressMutationContext } from "@/lib/domain/account/customer-address.types";
import type { CustomerAddressRepository } from "./customer-address-repository";

export async function importLocalAddresses(context: CustomerAddressMutationContext, input: unknown, repository: CustomerAddressRepository) {
  const parsed = LegacyCustomerAddressImportSchema.safeParse(input);
  if (!parsed.success) return { imported: 0, skipped: 0, invalid: 0, addresses: await repository.list(context) };

  const seen = new Set<string>();
  const normalized: CustomerAddressInput[] = [];
  let invalid = 0;
  let skipped = 0;

  for (const legacyAddress of parsed.data.addresses) {
    const result = normalizeLegacyAddress(legacyAddress);
    if (!result.success) {
      invalid += 1;
      continue;
    }
    const fingerprint = addressFingerprint(result.data);
    if (seen.has(fingerprint)) {
      skipped += 1;
      continue;
    }
    seen.add(fingerprint);
    normalized.push(result.data);
  }

  if (!normalized.length) {
    return { imported: 0, skipped, invalid, addresses: await repository.list(context) };
  }

  const result = await repository.importLegacy(context, normalized);
  return {
    imported: result.imported,
    skipped: result.skipped + skipped,
    invalid,
    addresses: result.addresses
  };
}
