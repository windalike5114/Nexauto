export function AdminOrderStatusBadge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "good" | "warning" | "danger" }) {
  const classes = {
    neutral: "bg-zinc-100 text-steel",
    good: "bg-emerald-50 text-emerald-800",
    warning: "bg-amber-50 text-amber-800",
    danger: "bg-red-50 text-signal"
  };

  return <span className={`rounded px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${classes[tone]}`}>{label}</span>;
}
