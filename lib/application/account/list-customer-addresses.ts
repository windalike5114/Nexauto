import type { CustomerAddressRepository } from "./customer-address-repository";
import type { CustomerAddressMutationContext } from "@/lib/domain/account/customer-address.types";

export function listCustomerAddresses(context: CustomerAddressMutationContext, repository: CustomerAddressRepository) {
  return repository.list(context);
}
