import type { AdminOrderDetailSectionError } from "@/lib/application/admin/admin-order-detail.types";

export function AdminOrderSectionError({ error }: { error: AdminOrderDetailSectionError }) {
  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
      <p className="font-black">{error.title}</p>
      <p className="mt-1">{error.message}</p>
    </div>
  );
}
