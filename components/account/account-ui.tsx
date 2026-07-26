export function Panel({ title, icon, children, className = "" }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-black/10 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded bg-zinc-100 text-signal">{icon}</span>
        <h2 className="text-xl font-black">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-black/10 bg-zinc-50 p-6 text-center text-sm font-bold text-steel">{text}</div>;
}

export function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black/10 bg-white p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className="mt-1 text-sm font-black text-ink">{value}</p>
    </div>
  );
}
