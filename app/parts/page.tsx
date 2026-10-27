import type { Metadata } from "next";
import { StorefrontCatalogPage, type StorefrontParams } from "@/components/storefront-catalog-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Parts for Your Vehicle", description: "Find confirmed matches and compare vehicle-specific options." };
export default async function PartsPage({ searchParams }: { searchParams: Promise<StorefrontParams> }) { return <StorefrontCatalogPage params={await searchParams}/>; }
