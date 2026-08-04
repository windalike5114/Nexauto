import type { AdminOrderDetailWarning } from "@/lib/application/admin/admin-order-detail.types";

export function AdminOrderAttentionCard({ warnings }: { warnings: AdminOrderDetailWarning[] }) {
  if (!warnings.length) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
        <h2 className="text-lg font-black text-emerald-950">Operational attention</h2>
        <p className="mt-2 text-sm font-bold text-emerald-800">No operational warnings detected from stored order data.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Operational attention</h2>
      <div className="mt-4 grid gap-3">
        {warnings.map((warning) => (
          <article key={`${warning.code}:${warning.relatedItemId ?? ""}:${warning.relatedFulfilmentId ?? ""}`} className={`rounded border p-3 ${getTone(warning.severity)}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-black">{warning.title}</p>
                <p className="mt-1 text-sm font-bold">{warning.message}</p>
              </div>
              <span className="text-xs font-black uppercase tracking-[0.12em]">{warning.blocksFulfilment ? "Blocks fulfilment" : warning.severity}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function getTone(severity: AdminOrderDetailWarning["severity"]) {
  if (severity === "critical") return "border-red-200 bg-red-50 text-red-900";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-zinc-200 bg-zinc-50 text-steel";
}
