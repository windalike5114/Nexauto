export type CustomerAddress = {
  id: string;
  customerProfileId: string;
  label: string | null;
  recipientName: string;
  company: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  suburb: string | null;
  city: string;
  region: string | null;
  postcode: string;
  country: "NZ";
  isDefaultShipping: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomerAddressMutationContext = {
  authUserId: string;
  customerProfileId: string;
};

export type CustomerAddressImportResult = {
  imported: number;
  skipped: number;
  invalid: number;
  addresses: CustomerAddress[];
};
