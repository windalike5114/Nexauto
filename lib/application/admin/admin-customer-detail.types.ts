import type { AdminAccessContext } from "@/lib/domain/admin/admin-access.types";

export type AdminCustomerDetailProfileRow = {
  id: string;
  authUserId: string | null;
  email: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminCustomerDetailOrderRow = {
  id: string;
  orderNumber: string;
  email: string | null;
  customerName: string | null;
  subtotal: number;
  currency: string;
  status: string;
  createdAt: string;
};

export type AdminCustomerDetailVehicleRow = {
  id: string;
  applicationId: string | null;
  label: string | null;
  make: string;
  model: string;
  year: number;
  source: string;
  isDefault: boolean;
  lastUsedAt: string;
  createdAt: string;
};

export type AdminCustomerDetailAddressRow = {
  id: string;
  label: string | null;
  recipientName: string;
  company: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  suburb: string | null;
  city: string;
  region: string | null;
  postcode: string | null;
  country: string;
  isDefaultShipping: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminCustomerDetailVehicleSnapshotRow = {
  id: string;
  orderId: string;
  vehicleApplicationId: string | null;
  customerVehicleId: string | null;
  make: string;
  model: string;
  year: number;
  createdAt: string;
};

export type AdminCustomerDetailClaimEventRow = {
  id: string;
  orderId: string | null;
  method: string;
  status: string;
  createdAt: string;
};

export type AdminCustomerDetailRepositoryResult = {
  profile: AdminCustomerDetailProfileRow | null;
  orders: AdminCustomerDetailOrderRow[];
  vehicles: AdminCustomerDetailVehicleRow[];
  addresses: AdminCustomerDetailAddressRow[];
  vehicleSnapshots: AdminCustomerDetailVehicleSnapshotRow[];
  claimEvents: AdminCustomerDetailClaimEventRow[];
};

export type AdminCustomerDetailRepository = {
  loadCustomerDetail(customerProfileId: string, context: AdminAccessContext): Promise<AdminCustomerDetailRepositoryResult>;
};

export type AdminCustomerDetail = {
  profile: AdminCustomerDetailProfileRow & {
    accountType: "registered" | "email_profile";
  };
  summary: {
    orderCount: number;
    totalSpent: number;
    savedVehicleCount: number;
    addressCount: number;
    claimedOrderCount: number;
    latestOrderAt: string | null;
    defaultVehicleLabel: string | null;
  };
  orders: Array<AdminCustomerDetailOrderRow & { detailUrl: string }>;
  vehicles: Array<AdminCustomerDetailVehicleRow & { displayLabel: string }>;
  addresses: AdminCustomerDetailAddressRow[];
  vehicleHistory: Array<AdminCustomerDetailVehicleSnapshotRow & { displayLabel: string; orderNumber: string | null; orderDetailUrl: string }>;
  claimEvents: AdminCustomerDetailClaimEventRow[];
};
