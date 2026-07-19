import { CustomerAddressPatchSchema, type CustomerAddressPatch } from "@/lib/domain/account/customer-address.schema";
import { CustomerAddressError } from "@/lib/domain/account/customer-address.errors";
import type { CustomerAddressMutationContext } from "@/lib/domain/account/customer-address.types";
import type { CustomerAddressRepository } from "./customer-address-repository";

export async function updateCustomerAddress(
  context: CustomerAddressMutationContext,
  addressId: string,
  input: unknown,
  repository: CustomerAddressRepository
) {
  const parsed = CustomerAddressPatchSchema.safeParse(input);
  if (!parsed.success) throw new CustomerAddressError("ADDRESS_VALIDATION_FAILED", "Address details are invalid.");
  return repository.update(context, addressId, parsed.data as CustomerAddressPatch);
}
