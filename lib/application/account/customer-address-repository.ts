import type { CustomerAddressInput, CustomerAddressPatch } from "@/lib/domain/account/customer-address.schema";
import type { CustomerAddress, CustomerAddressImportResult, CustomerAddressMutationContext } from "@/lib/domain/account/customer-address.types";

export type CustomerAddressRepository = {
  list(context: CustomerAddressMutationContext): Promise<CustomerAddress[]>;
  create(context: CustomerAddressMutationContext, input: CustomerAddressInput): Promise<CustomerAddress>;
  update(context: CustomerAddressMutationContext, addressId: string, input: CustomerAddressPatch): Promise<CustomerAddress>;
  delete(context: CustomerAddressMutationContext, addressId: string): Promise<{ deletedAddressId: string; replacementDefaultAddressId: string | null }>;
  setDefault(context: CustomerAddressMutationContext, addressId: string): Promise<CustomerAddress>;
  importLegacy(context: CustomerAddressMutationContext, inputs: CustomerAddressInput[]): Promise<CustomerAddressImportResult>;
};
