import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrakePadProductView } from "@/components/brake-pad-product-view";
import { getBrakePadBySlugOrPartNumber } from "@/lib/queries/brake-pad-catalog";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const detail = await getBrakePadBySlugOrPartNumber(sku);
  if (!detail) {
    return {
      title: "Brake Pads",
      description: "Brake-pad dimensions and vehicle fitment support from NexAutoParts."
    };
  }

  return {
    title: detail.title,
    description: `${detail.title}. Dimensions and vehicle fitment details for New Zealand drivers.`,
    alternates: { canonical: `/brake-pads/${encodeURIComponent(detail.partNumber)}` }
  };
}

export default async function BrakePadPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const detail = await getBrakePadBySlugOrPartNumber(sku);
  if (!detail) notFound();
  return <BrakePadProductView detail={detail} />;
}
