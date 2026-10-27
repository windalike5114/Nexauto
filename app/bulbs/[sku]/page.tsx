import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BulbProductView } from "@/components/bulb-product-view";
import { getBulbBySku } from "@/lib/queries/bulb-catalog";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const detail = await getBulbBySku(sku);
  if (!detail) return { title: "Bulb not found" };
  return { title: detail.title, description: `${detail.subtitle}. ${detail.features[0] ?? ""}`,
    alternates: { canonical: `/bulbs/${detail.sku}` } };
}

export default async function BulbPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const detail = await getBulbBySku(sku);
  if (!detail) notFound();
  return <BulbProductView detail={detail} />;
}
