import type { Metadata } from "next";
import { StorefrontCatalogPage, type StorefrontParams } from "@/components/storefront-catalog-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shop All Auto Parts", description: "Browse NexAutoParts by category, specification, SKU or vehicle." };
export default async function ShopPage({ searchParams }: { searchParams: Promise<StorefrontParams> }) { return <StorefrontCatalogPage params={await searchParams}/>; }
