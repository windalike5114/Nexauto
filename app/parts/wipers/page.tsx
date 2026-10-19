import { redirect } from "next/navigation";

export default async function LegacyWiperListingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentQuery = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(currentQuery)) {
    if (typeof value === "string" && value) query.set(key, value);
  }
  query.set("category", "wipers");
  redirect(`/parts?${query}`);
}
