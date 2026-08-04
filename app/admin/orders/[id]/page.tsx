import Link from "next/link";
import { AdminOrderAttentionCard } from "@/components/admin/order-detail/admin-order-attention-card";
import { AdminOrderCustomerCard } from "@/components/admin/order-detail/admin-order-customer-card";
import { AdminOrderEmailCard } from "@/components/admin/order-detail/admin-order-email-card";
import { AdminOrderError } from "@/components/admin/order-detail/admin-order-error";
import { AdminOrderFulfilmentCard } from "@/components/admin/order-detail/admin-order-fulfilment-card";
import { AdminOrderHeader } from "@/components/admin/order-detail/admin-order-header";
import { AdminOrderItemsCard } from "@/components/admin/order-detail/admin-order-items-card";
import { AdminOrderPaymentCard } from "@/components/admin/order-detail/admin-order-payment-card";
import { AdminOrderPricingCard } from "@/components/admin/order-detail/admin-order-pricing-card";
import { AdminOrderTimeline } from "@/components/admin/order-detail/admin-order-timeline";
import { AdminOrderVehiclesCard } from "@/components/admin/order-detail/admin-order-vehicles-card";
import { AdminOrderWebhookCard } from "@/components/admin/order-detail/admin-order-webhook-card";
import { AdminOrderDetailInvalidIdError, AdminOrderDetailNotFoundError } from "@/lib/application/admin/get-admin-order-detail";
import { AdminConfigurationError, AdminForbiddenError, AdminInfrastructureError, AdminUnauthenticatedError } from "@/lib/domain/admin/admin-access.errors";
import { loadAdminOrderDetailData } from "@/lib/queries/admin";
import { retryOrderEmailAction, retryStripeWebhookAction, updateFulfillmentAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadOrder(id);
  if (!result.ok) return <AdminOrderError title={result.title} message={result.message} />;

  const order = result.order;
  const emailErrors = order.sectionErrors.filter((error) => error.section === "email");
  const webhookErrors = order.sectionErrors.filter((error) => error.section === "webhook");
  const timelineErrors = order.sectionErrors.filter((error) => error.section === "audit");

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/admin?tab=orders" className="text-sm font-black text-steel hover:text-ink">
          Back to orders
        </Link>

        <div className="mt-5 grid gap-5">
          <AdminOrderHeader order={order} />
          <AdminOrderAttentionCard warnings={order.warnings} />

          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="grid gap-5">
              <AdminOrderItemsCard items={order.items} />
              <AdminOrderFulfilmentCard fulfilments={order.fulfilments} items={order.items} vehicles={order.vehicleSnapshots} action={updateFulfillmentAction} />
              <AdminOrderVehiclesCard vehicles={order.vehicleSnapshots} />
            </div>
            <div className="grid content-start gap-5">
              <AdminOrderCustomerCard customer={order.customer} />
              <AdminOrderPaymentCard payment={order.payment} />
              <AdminOrderPricingCard pricing={order.pricing} />
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <AdminOrderEmailCard orderId={order.identity.id} events={order.emailEvents} errors={emailErrors} retryAction={retryOrderEmailAction} />
            <AdminOrderWebhookCard orderId={order.identity.id} events={order.webhookEvents} errors={webhookErrors} retryAction={retryStripeWebhookAction} />
          </div>
          <AdminOrderTimeline events={order.auditTimeline} errors={timelineErrors} />
        </div>
      </div>
    </main>
  );
}

async function loadOrder(id: string) {
  try {
    return { ok: true as const, order: await loadAdminOrderDetailData(id) };
  } catch (error) {
    if (error instanceof AdminUnauthenticatedError) {
      return { ok: false as const, title: "Admin sign-in required", message: "Please sign in with an admin account before opening order details." };
    }
    if (error instanceof AdminForbiddenError) {
      return { ok: false as const, title: "Admin access required", message: "This account is not allowed to view admin order details." };
    }
    if (error instanceof AdminConfigurationError) {
      return { ok: false as const, title: "Admin configuration missing", message: "Admin access is not configured for this environment." };
    }
    if (error instanceof AdminOrderDetailInvalidIdError) {
      return { ok: false as const, title: "Invalid order", message: "This order link does not contain a valid order ID." };
    }
    if (error instanceof AdminOrderDetailNotFoundError) {
      return { ok: false as const, title: "Order not found", message: "No order exists for this ID." };
    }
    if (error instanceof AdminInfrastructureError) {
      return { ok: false as const, title: "Admin service unavailable", message: "Admin access could not be verified. Please try again shortly." };
    }
    console.error("admin.order_detail_failed", { error: getErrorLogDetails(error) });
    return { ok: false as const, title: "Order detail unavailable", message: "The critical order detail data could not be loaded safely." };
  }
}

function getErrorLogDetails(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message };
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    return { code: candidate.code, message: candidate.message };
  }
  return { message: "Unknown order detail error" };
}
