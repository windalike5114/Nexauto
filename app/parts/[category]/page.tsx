import { notFound, redirect } from "next/navigation";

const supportedCategories: Record<string, string> = {
  batteries: "batteries",
  filters: "filters",
  brakes: "brakes",
  bulbs: "bulbs",
  suspension: "suspension"
};

export default async function LegacyPartCategoryPage({
  params,
  searchParams
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ category }, currentQuery] = await Promise.all([params, searchParams]);
  const mappedCategory = supportedCategories[category];
  if (!mappedCategory) notFound();

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(currentQuery)) {
    if (typeof value === "string" && value) query.set(key, value);
  }
  query.set("category", mappedCategory);
  redirect(`/parts?${query}`);
}
