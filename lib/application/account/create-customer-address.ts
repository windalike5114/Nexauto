import { CustomerAddressInputSchema, type CustomerAddressInput } from "@/lib/domain/account/customer-address.schema";
import { CustomerAddressError } from "@/lib/domain/account/customer-address.errors";
import type { CustomerAddressMutationContext } from "@/lib/domain/account/customer-address.types";
import type { CustomerAddressRepository } from "./customer-address-repository";

export async function createCustomerAddress(context: CustomerAddressMutationContext, input: unknown, repository: CustomerAddressRepository) {
  const parsed = CustomerAddressInputSchema.safeParse(input);
  if (!parsed.success) throw new CustomerAddressError("ADDRESS_VALIDATION_FAILED", "Address details are invalid.");
  return repository.create(context, parsed.data as CustomerAddressInput);
}
