export function AdminOrderError({ message = "Orders could not be loaded." }: { message?: string }) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50 p-5">
      <p className="font-black text-ink">Order list unavailable</p>
      <p className="mt-2 text-sm font-bold leading-6 text-steel">{message}</p>
    </div>
  );
}
