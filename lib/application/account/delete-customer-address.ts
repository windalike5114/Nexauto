import type { CustomerAddressMutationContext } from "@/lib/domain/account/customer-address.types";
import type { CustomerAddressRepository } from "./customer-address-repository";

export function deleteCustomerAddress(context: CustomerAddressMutationContext, addressId: string, repository: CustomerAddressRepository) {
  return repository.delete(context, addressId);
}
