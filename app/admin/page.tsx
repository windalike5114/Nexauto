import { Boxes, ClipboardList, PackagePlus } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { listAdminStock, listProducts } from "@/lib/queries/catalog";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { products, stockRows, error } = await loadAdminData();
  const totalStock = stockRows.reduce((sum, variant) => sum + variant.stock, 0);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Admin</p>
        <h1 className="mt-2 text-4xl font-black">Operations</h1>
      </div>

      {error ? <div className="mb-6 rounded-lg border border-signal/30 bg-white p-5 text-sm font-bold text-signal">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <Metric icon={<PackagePlus className="h-5 w-5" />} label="Products" value={String(products.length)} />
        <Metric icon={<Boxes className="h-5 w-5" />} label="SKU stock" value={String(totalStock)} />
        <Metric icon={<ClipboardList className="h-5 w-5" />} label="Orders" value="Database" />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Add product</h2>
          <form className="mt-5 space-y-4">
            <input className="h-11 w-full rounded border border-black/10 px-3" placeholder="Product name" />
            <input className="h-11 w-full rounded border border-black/10 px-3" placeholder="Category slug" />
            <textarea className="min-h-28 w-full rounded border border-black/10 p-3" placeholder="Description" />
            <button type="button" className="h-11 w-full rounded bg-ink px-4 font-black text-white">
              Save draft
            </button>
          </form>
          <p className="mt-4 text-sm leading-6 text-steel">
            This MVP admin surface is wired for database visibility first. Write actions should be protected by Supabase Auth before launch.
          </p>
        </div>

        <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Stock by SKU</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-black/10 text-xs uppercase tracking-[0.14em] text-steel">
                <tr>
                  <th className="py-3">SKU</th>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {stockRows.map((variant) => (
                  <tr key={variant.sku} className="border-b border-black/5">
                    <td className="py-3 font-mono font-bold">{variant.sku}</td>
                    <td>{getProductName(variant.products) ?? variant.product_id}</td>
                    <td>{formatMoney(Number(variant.price))}</td>
                    <td>
                      <input
                        aria-label={`Stock for ${variant.sku}`}
                        className="h-9 w-20 rounded border border-black/10 px-2 font-bold"
                        defaultValue={variant.stock}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stockRows.length === 0 ? <p className="py-8 text-center font-bold text-steel">No SKUs found.</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

async function loadAdminData() {
  try {
    const [products, stockRows] = await Promise.all([listProducts(), listAdminStock()]);
    return { products, stockRows, error: "" };
  } catch (error) {
    return {
      products: [],
      stockRows: [],
      error: error instanceof Error ? error.message : "Could not load Supabase admin data."
    };
  }
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3 text-steel">
        {icon}
        <span className="text-sm font-black uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="mt-4 text-3xl font-black">{value}</p>
    </div>
  );
}

function getProductName(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) return getProductName(value[0]);
  if (typeof value === "object" && "name" in value) {
    return String((value as { name: string }).name);
  }
  return null;
}
