import type { AdminOrderDetailEmailEvent, AdminOrderDetailSectionError } from "@/lib/application/admin/admin-order-detail.types";
import { AdminOrderSectionError } from "./admin-order-section-error";

export function AdminOrderEmailCard({ events, errors }: { events: AdminOrderDetailEmailEvent[]; errors: AdminOrderDetailSectionError[] }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Email events</h2>
      <div className="mt-4 grid gap-3">
        {errors.map((error) => (
          <AdminOrderSectionError key={error.section} error={error} />
        ))}
        {events.map((event) => (
          <article key={event.id} className="rounded border border-black/10 bg-zinc-50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-black">{event.type}</h3>
                <p className="mt-1 break-all text-sm font-bold text-steel">{event.recipient}</p>
              </div>
              <span className="w-fit rounded bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-steel ring-1 ring-black/10">{event.status}</span>
            </div>
            <dl className="mt-3 grid gap-2 text-xs font-bold text-steel">
              <Meta label="Updated" value={formatDate(event.displayTimestamp)} />
              <Meta label="Provider ID" value={event.resendEmailId ?? "Not attached"} mono />
              <Meta label="Attempts" value={String(event.attemptCount ?? 0)} />
              <Meta label="Error" value={event.lastErrorSummary ?? event.errorCode ?? "None"} />
            </dl>
          </article>
        ))}
        {!events.length && !errors.length ? <p className="text-sm font-bold text-steel">No related order email events recorded.</p> : null}
      </div>
    </section>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.12em]">{label}</dt>
      <dd className={`mt-1 break-all text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-NZ");
}
