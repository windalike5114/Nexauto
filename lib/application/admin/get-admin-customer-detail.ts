import type { AdminAccessContext } from "@/lib/domain/admin/admin-access.types";
import { isLooseUuid } from "@/lib/domain/shared/uuid";
import type { AdminCustomerDetail, AdminCustomerDetailRepository } from "./admin-customer-detail.types";

export class AdminCustomerDetailInvalidIdError extends Error {
  constructor() {
    super("Admin customer detail requires a valid customer profile ID.");
    this.name = "AdminCustomerDetailInvalidIdError";
  }
}

export class AdminCustomerDetailNotFoundError extends Error {
  constructor() {
    super("Customer profile was not found.");
    this.name = "AdminCustomerDetailNotFoundError";
  }
}

export async function getAdminCustomerDetail(customerProfileId: string, access: AdminAccessContext, repository: AdminCustomerDetailRepository): Promise<AdminCustomerDetail> {
  if (!isLooseUuid(customerProfileId)) throw new AdminCustomerDetailInvalidIdError();

  const data = await repository.loadCustomerDetail(customerProfileId, access);
  if (!data.profile) throw new AdminCustomerDetailNotFoundError();

  const orderNumberById = new Map(data.orders.map((order) => [order.id, order.orderNumber]));
  const defaultVehicle = data.vehicles.find((vehicle) => vehicle.isDefault) ?? null;

  return {
    profile: {
      ...data.profile,
      accountType: data.profile.authUserId ? "registered" : "email_profile"
    },
    summary: {
      orderCount: data.orders.length,
      totalSpent: roundMoney(data.orders.reduce((total, order) => total + order.subtotal, 0)),
      savedVehicleCount: data.vehicles.length,
      addressCount: data.addresses.length,
      claimedOrderCount: data.claimEvents.filter((event) => event.status === "claimed" || event.status === "success").length,
      latestOrderAt: data.orders[0]?.createdAt ?? null,
      defaultVehicleLabel: defaultVehicle ? formatVehicleLabel(defaultVehicle.year, defaultVehicle.make, defaultVehicle.model) : null
    },
    orders: data.orders.map((order) => ({
      ...order,
      detailUrl: `/admin/orders/${order.id}`
    })),
    vehicles: data.vehicles.map((vehicle) => ({
      ...vehicle,
      displayLabel: formatVehicleLabel(vehicle.year, vehicle.make, vehicle.model)
    })),
    addresses: data.addresses,
    vehicleHistory: data.vehicleSnapshots.map((vehicle) => ({
      ...vehicle,
      displayLabel: formatVehicleLabel(vehicle.year, vehicle.make, vehicle.model),
      orderNumber: orderNumberById.get(vehicle.orderId) ?? null,
      orderDetailUrl: `/admin/orders/${vehicle.orderId}`
    })),
    claimEvents: data.claimEvents
  };
}

export function formatVehicleLabel(year: number, make: string, model: string) {
  return `${year} ${make} ${model}`.replace(/\s+/g, " ").trim();
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
