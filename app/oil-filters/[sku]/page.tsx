import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OilFilterProductView } from "@/components/oil-filter-product-view";
import { getOilFilterBySku } from "@/lib/queries/oil-filter-catalog";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const detail = await getOilFilterBySku(sku);
  if (!detail) return { title: "Oil Filter", description: "Oil-filter specifications and vehicle fitment support from NexAutoParts." };

  return {
    title: detail.title,
    description: `${detail.title}. Dimensions, model coverage and vehicle fitment support for New Zealand drivers.`,
    alternates: { canonical: `/oil-filters/${encodeURIComponent(detail.partNumber)}` }
  };
}

export default async function OilFilterPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const detail = await getOilFilterBySku(sku);
  if (!detail) notFound();
  return <OilFilterProductView detail={detail} />;
}
