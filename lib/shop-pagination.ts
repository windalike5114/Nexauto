export const SHOP_PAGE_SIZE = 12;
export const MAX_SHOP_PAGE = 1_000;

export type ShopPageQuery = {
  category?: string;
  q?: string;
};

export function parseShopPage(value: string | undefined) {
  if (!value) return 1;
  if (!/^[1-9]\d{0,3}$/.test(value)) return null;

  const page = Number(value);
  return page <= MAX_SHOP_PAGE ? page : null;
}

export function paginateShopItems<T>(items: T[], page: number) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / SHOP_PAGE_SIZE));
  const startIndex = (page - 1) * SHOP_PAGE_SIZE;

  return {
    items: items.slice(startIndex, startIndex + SHOP_PAGE_SIZE),
    page,
    pageSize: SHOP_PAGE_SIZE,
    startIndex,
    totalItems,
    totalPages
  };
}

export function buildShopPageHref(query: ShopPageQuery, page: number) {
  const params = new URLSearchParams();
  if (query.category && query.category !== "all") params.set("category", query.category);
  if (query.q) params.set("q", query.q);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/shop?${search}` : "/shop";
}

export function getShopPaginationPages(currentPage: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  return [...new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages])]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
}
