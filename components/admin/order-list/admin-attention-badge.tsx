import type { AdminAttentionReason } from "@/lib/application/admin/admin-order-list.types";

const labels: Record<AdminAttentionReason, string> = {
  fulfilment_issue: "Fulfilment issue",
  missing_fulfilment: "Missing fulfilment",
  missing_adapter: "Adapter required",
  email_failed: "Email failed",
  stale_pending: "Stale pending"
};

export function AdminAttentionBadge({ reasons }: { reasons: AdminAttentionReason[] }) {
  if (!reasons.length) return <span className="text-xs font-bold text-steel">No attention needed</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <span key={reason} className="rounded bg-red-50 px-2 py-1 text-[11px] font-black uppercase tracking-[0.1em] text-signal">
          {labels[reason]}
        </span>
      ))}
    </div>
  );
}
