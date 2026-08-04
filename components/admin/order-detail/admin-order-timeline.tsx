import type { AdminOrderDetailSectionError, AdminOrderDetailTimelineEvent } from "@/lib/application/admin/admin-order-detail.types";
import { AdminOrderSectionError } from "./admin-order-section-error";

export function AdminOrderTimeline({ events, errors }: { events: AdminOrderDetailTimelineEvent[]; errors: AdminOrderDetailSectionError[] }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Recovery and audit timeline</h2>
      <div className="mt-4 grid gap-3">
        {errors.map((error) => (
          <AdminOrderSectionError key={error.section} error={error} />
        ))}
        {events.map((event) => (
          <article key={event.id} className="rounded border border-black/10 bg-zinc-50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-black">{event.title}</h3>
                <p className="mt-1 text-sm font-bold text-steel">{event.description}</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-steel">{event.category}</p>
                <p className="mt-1 text-xs font-bold text-steel">{formatDate(event.timestamp)}</p>
              </div>
            </div>
            {event.relatedIdentifier ? <p className="mt-3 break-all font-mono text-xs font-bold text-steel">{event.relatedIdentifier}</p> : null}
          </article>
        ))}
        {!events.length && !errors.length ? <p className="text-sm font-bold text-steel">No persisted timeline events recorded.</p> : null}
      </div>
    </section>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-NZ");
}
