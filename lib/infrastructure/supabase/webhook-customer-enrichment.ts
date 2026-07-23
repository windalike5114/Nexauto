import type { FinalisedOrder } from "@/lib/application/orders/finalise-paid-order";
import type { CustomerEnrichmentService } from "@/lib/application/webhooks/process-stripe-event";
import { getOrCreateCustomerProfileByEmail, saveCustomerVehicleByEmail } from "@/lib/queries/account";

export function createWebhookCustomerEnrichmentService(): CustomerEnrichmentService {
  return {
    async enrichFromFinalisedOrder(order) {
      if (!order.email) return;
      await getOrCreateCustomerProfileByEmail(order.email, order.customerName);

      if (order.vehicle?.a && order.vehicle.make && order.vehicle.model && order.vehicle.year) {
        await saveCustomerVehicleByEmail(
          order.email,
          {
            applicationId: String(order.vehicle.a),
            make: String(order.vehicle.make),
            model: String(order.vehicle.model),
            year: Number(order.vehicle.year)
          },
          order.customerName
        );
      }
    }
  };
}
