import { allocateOrderNumber } from "@/lib/order-number";
import { createSupabaseAdminClient } from "@/lib/supabase";
import type { CheckoutOrderRepository, PendingCheckoutOrderInput } from "@/lib/application/checkout/create-checkout-session";
import { isLooseUuid } from "@/lib/domain/shared/uuid";

export function createSupabaseCheckoutOrderRepository(): CheckoutOrderRepository {
  return {
    async createPendingOrder(input) {
      const supabase = createSupabaseAdminClient();
      if (!supabase) throw new Error("Supabase service role key is not configured.");

      const itemsSnapshot = buildItemsSnapshot(input);
      const { data: order, error } = await supabase
        .from("orders")
        .insert({
          email: input.customerEmail,
          items_snapshot: {
            checkout_version: input.pricing.checkoutVersion,
            pricing_version: input.pricing.pricingVersion,
            checkout_request_id: input.checkoutRequestId,
            items: itemsSnapshot,
            vehicle: input.vehicle,
            pricing: input.pricing,
            reward_state: input.rewardState,
            checkout_state: "pending_stripe_payment"
          },
          checkout_version: input.pricing.checkoutVersion,
          pricing_version: input.pricing.pricingVersion,
          pricing_snapshot: input.pricing,
          reward_state: input.rewardState,
          subtotal: input.pricing.finalSubtotal,
          currency: input.currency,
          status: "pending"
        })
        .select("id")
        .single();

      if (error || !order?.id) {
        throw new Error(error?.message ?? "Could not create pending order.");
      }

      const orderId = order.id as string;
      const orderNumber = await allocateOrderNumber(supabase, orderId);
      const snapshot = {
        checkout_version: input.pricing.checkoutVersion,
        pricing_version: input.pricing.pricingVersion,
        checkout_request_id: input.checkoutRequestId,
        order_number: orderNumber,
        items: itemsSnapshot,
        vehicle: input.vehicle,
        pricing: input.pricing,
        reward_state: input.rewardState,
        checkout_state: "pending_stripe_payment"
      };

      await supabase
        .from("orders")
        .update({
          items_snapshot: snapshot,
          updated_at: new Date().toISOString()
        })
        .eq("id", orderId);

      const { error: itemsError } = await supabase.from("order_items").insert(
        input.items.map((item, index) => {
          const sourceLineKey = buildSourceLineKey(item, index);
          return {
          order_id: orderId,
          product_id: isLooseUuid(item.productId) ? item.productId : null,
          variant_id: item.productId !== "wiper_set" && item.productId !== "wiper_rear_addon" && isLooseUuid(item.id) ? item.id : null,
          sku: item.sku,
          product_name: item.name,
          attributes: {
            ...item.attributes,
            logical_product_id: item.productId,
            logical_variant_id: item.id,
            bundle_discount: item.bundleDiscount ?? 0,
            finalisation_line_key: sourceLineKey
          },
          qty: item.cartItem.qty,
          unit_price: item.checkoutLineTotal ? roundMoney(item.checkoutLineTotal / item.cartItem.qty) : item.price,
          line_subtotal: item.price * item.cartItem.qty,
          line_discount: item.bundleDiscount ?? 0,
          line_total: item.checkoutLineTotal ?? item.price * item.cartItem.qty,
          source_line_key: sourceLineKey,
          vehicle_application_id: getVehicleApplicationId(item.attributes),
          wiper_set_id: item.productId === "wiper_set" && isLooseUuid(item.id) ? item.id : null,
          vehicle_snapshot: buildVehicleSnapshot(item.attributes),
          product_snapshot: buildProductSnapshot(item)
        };
        })
      );

      if (itemsError) throw new Error(itemsError.message);

      if (input.vehicle?.a && input.vehicle.make && input.vehicle.model && input.vehicle.year) {
        const { error: vehicleError } = await supabase.from("order_vehicle_snapshots").insert({
          order_id: orderId,
          vehicle_application_id: isLooseUuid(String(input.vehicle.a)) ? input.vehicle.a : null,
          make_snapshot: String(input.vehicle.make),
          model_snapshot: String(input.vehicle.model),
          year: Number(input.vehicle.year)
        });

        if (vehicleError) throw new Error(vehicleError.message);
      }

      return { id: orderId, orderNumber };
    },

    async attachStripeSession(orderId, stripeSessionId) {
      const supabase = createSupabaseAdminClient();
      if (!supabase) throw new Error("Supabase service role key is not configured.");

      const { error } = await supabase
        .from("orders")
        .update({
          stripe_session_id: stripeSessionId,
          updated_at: new Date().toISOString()
        })
        .eq("id", orderId);

      if (error) throw new Error(error.message);
    },

    async markCheckoutSessionFailed(orderId, reason) {
      const supabase = createSupabaseAdminClient();
      if (!supabase) return;

      const { data } = await supabase.from("orders").select("items_snapshot").eq("id", orderId).maybeSingle();
      const snapshot = data?.items_snapshot && typeof data.items_snapshot === "object" ? data.items_snapshot : {};

      await supabase
        .from("orders")
        .update({
          items_snapshot: {
            ...snapshot,
            checkout_state: "checkout_session_failed",
            checkout_failure_reason: reason
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", orderId);
    }
  };
}

function buildItemsSnapshot(input: PendingCheckoutOrderInput) {
  return input.items.map((item, index) => {
    const sourceLineKey = buildSourceLineKey(item, index);
    return {
    product_id: item.productId,
    variant_id: item.id,
    sku: item.sku,
    product_name: item.name,
    product_snapshot: buildProductSnapshot(item),
    vehicle_application_id: getVehicleApplicationId(item.attributes),
    wiper_set_id: item.productId === "wiper_set" && isLooseUuid(item.id) ? item.id : null,
    vehicle_snapshot: buildVehicleSnapshot(item.attributes),
    attributes: {
      ...item.attributes,
      finalisation_line_key: sourceLineKey
    },
    qty: item.cartItem.qty,
    unit_price: item.checkoutLineTotal ? roundMoney(item.checkoutLineTotal / item.cartItem.qty) : item.price,
    line_subtotal: item.price * item.cartItem.qty,
    line_discount: item.bundleDiscount ?? 0,
    line_total: item.checkoutLineTotal ?? item.price * item.cartItem.qty,
    bundle_discount: item.bundleDiscount ?? 0,
    source_line_key: sourceLineKey
  };
  });
}

function buildSourceLineKey(item: PendingCheckoutOrderInput["items"][number], index: number) {
  return item.cartItem.lineId || [
    "line",
    index,
    item.productId,
    item.id,
    item.sku,
    String(item.attributes.vehicle_application_id ?? ""),
    String(item.attributes.vehicle ?? "")
  ].join(":");
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function getVehicleApplicationId(attributes: PendingCheckoutOrderInput["items"][number]["attributes"]) {
  const value = attributes.vehicle_application_id;
  return typeof value === "string" && isLooseUuid(value) ? value : null;
}

function buildVehicleSnapshot(attributes: PendingCheckoutOrderInput["items"][number]["attributes"]) {
  return {
    vehicle_application_id: getVehicleApplicationId(attributes),
    make: attributes.vehicle_make ?? null,
    model: attributes.vehicle_model ?? null,
    year: attributes.vehicle_year ?? null,
    label: attributes.vehicle ?? null,
    driver_length: attributes.driver_length ?? null,
    passenger_length: attributes.passenger_length ?? null,
    rear_length: attributes.rear_length ?? null
  };
}

function buildProductSnapshot(item: PendingCheckoutOrderInput["items"][number]) {
  return {
    product_id: item.productId,
    variant_id: item.id,
    sku: item.sku,
    name: item.name,
    category: item.cartItem.category,
    attributes: item.attributes
  };
}
