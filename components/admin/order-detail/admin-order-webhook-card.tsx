import type { AdminOrderDetailSectionError, AdminOrderDetailWebhookEvent } from "@/lib/application/admin/admin-order-detail.types";
import { AdminOrderSectionError } from "./admin-order-section-error";

export function AdminOrderWebhookCard({
  orderId,
  events,
  errors,
  retryAction
}: {
  orderId: string;
  events: AdminOrderDetailWebhookEvent[];
  errors: AdminOrderDetailSectionError[];
  retryAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Stripe webhook events</h2>
      <div className="mt-4 grid gap-3">
        {errors.map((error) => (
          <AdminOrderSectionError key={error.section} error={error} />
        ))}
        {events.map((event) => (
          <article key={event.id} className="rounded border border-black/10 bg-zinc-50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-black">{event.eventType}</h3>
                <p className="mt-1 break-all font-mono text-xs font-bold text-steel">{event.stripeEventId}</p>
              </div>
              <span className={`w-fit rounded px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ring-1 ${tone(event.classification)}`}>{event.status}</span>
            </div>
            <dl className="mt-3 grid gap-2 text-xs font-bold text-steel">
              <Meta label="Attempts" value={String(event.attemptCount)} />
              <Meta label="First received" value={formatDate(event.firstReceivedAt)} />
              <Meta label="Last attempted" value={event.lastAttemptedAt ? formatDate(event.lastAttemptedAt) : "Not attempted"} />
              <Meta label="Processed" value={event.processedAt ? formatDate(event.processedAt) : "Not processed"} />
              <Meta label="Error" value={event.errorSummary ?? "None"} />
            </dl>
            {canRetry(event.status) ? (
              <form action={retryAction} className="mt-4">
                <input type="hidden" name="orderId" value={orderId} />
                <input type="hidden" name="stripeEventId" value={event.stripeEventId} />
                <button type="submit" className="rounded bg-ink px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white hover:bg-black">
                  Retry webhook
                </button>
              </form>
            ) : null}
          </article>
        ))}
        {!events.length && !errors.length ? <p className="text-sm font-bold text-steel">No related Stripe webhook events recorded.</p> : null}
      </div>
    </section>
  );
}

function canRetry(status: string) {
  return status === "failed_retryable";
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.12em]">{label}</dt>
      <dd className="mt-1 break-all text-ink">{value}</dd>
    </div>
  );
}

function tone(classification: AdminOrderDetailWebhookEvent["classification"]) {
  if (classification === "retryable" || classification === "terminal") return "bg-red-50 text-red-800 ring-red-200";
  if (classification === "processing") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-white text-steel ring-black/10";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-NZ");
}
