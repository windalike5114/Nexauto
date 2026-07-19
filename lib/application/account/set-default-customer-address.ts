import type { CustomerAddressMutationContext } from "@/lib/domain/account/customer-address.types";
import type { CustomerAddressRepository } from "./customer-address-repository";

export function setDefaultCustomerAddress(context: CustomerAddressMutationContext, addressId: string, repository: CustomerAddressRepository) {
  return repository.setDefault(context, addressId);
}
