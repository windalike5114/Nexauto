export function AdminOrderEmpty() {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-8 text-center">
      <p className="font-black text-ink">No matching orders</p>
      <p className="mt-2 text-sm font-bold text-steel">Try clearing filters or searching another order number, email, or customer name.</p>
    </div>
  );
}
