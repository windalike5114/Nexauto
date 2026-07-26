import type { AdminOrderListQuery } from "@/lib/application/admin/admin-order-list.types";

export function AdminOrderFilters({ query }: { query: AdminOrderListQuery }) {
  return (
    <form action="/admin" className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 shadow-sm lg:grid-cols-[1.4fr_repeat(7,minmax(0,1fr))_auto]">
      <input type="hidden" name="tab" value="orders" />
      <input type="hidden" name="page" value="1" />
      <label className="block">
        <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">Search</span>
        <input
          name="search"
          defaultValue={query.search ?? ""}
          placeholder="Order, email, customer"
          className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold outline-none focus:border-ink"
        />
      </label>
      <Select label="Order status" name="orderStatus" value={query.orderStatus} options={["pending", "paid", "cancelled", "refunded", "failed"]} />
      <Select label="Fulfilment" name="fulfilmentStatus" value={query.fulfilmentStatus} options={["pending", "selected", "packed", "fulfilled", "issue"]} />
      <Select label="Sort" name="sort" value={query.sort} options={["order_desc", "order_asc", "created_desc", "created_asc"]} labels={sortLabels} />
      <Select label="Page size" name="pageSize" value={String(query.pageSize)} options={["25", "50", "100"]} />
      <label className="block">
        <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">From</span>
        <input name="dateFrom" type="date" defaultValue={toDateInput(query.dateFrom)} className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold" />
      </label>
      <label className="block">
        <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">To</span>
        <input name="dateTo" type="date" defaultValue={toDateInput(query.dateTo)} className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold" />
      </label>
      <label className="flex h-11 items-center gap-2 self-end rounded border border-black/10 px-3">
        <input name="needsAttention" type="checkbox" value="true" defaultChecked={query.needsAttention} className="h-4 w-4 accent-red-600" />
        <span className="text-sm font-black">Needs attention</span>
      </label>
      <div className="flex items-end gap-2">
        <button type="submit" className="h-11 rounded bg-ink px-5 text-sm font-black text-white hover:bg-black">
          Apply
        </button>
        <a href="/admin?tab=orders" className="inline-flex h-11 items-center rounded border border-black/10 bg-white px-4 text-sm font-black text-steel hover:border-ink">
          Clear
        </a>
      </div>
    </form>
  );
}

const sortLabels: Record<string, string> = {
  order_desc: "Order number: newest first",
  order_asc: "Order number: oldest first",
  created_desc: "Created date: newest first",
  created_asc: "Created date: oldest first"
};

function Select({ label, name, value, options, labels = {} }: { label: string; name: string; value?: string; options: string[]; labels?: Record<string, string> }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="mt-2 h-11 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold">
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

function toDateInput(value?: string) {
  return value ? value.slice(0, 10) : "";
}
