import type { User } from "@supabase/supabase-js";
import { getOrCreateCustomerProfile } from "@/lib/queries/account";
import type { CustomerAddressMutationContext } from "@/lib/domain/account/customer-address.types";

export async function getCustomerAddressContext(user: User): Promise<CustomerAddressMutationContext> {
  const profile = await getOrCreateCustomerProfile(user);
  return {
    authUserId: user.id,
    customerProfileId: profile.id
  };
}
