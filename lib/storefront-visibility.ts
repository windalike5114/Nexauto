/** Temporary storefront hiding only; keep catalogue, stock, orders and admin data intact. */
const hiddenCategories = new Set(['battery', 'batteries', 'suspension', 'control-arm', 'control-arms']);

export function isStorefrontCategoryVisible(category: string | undefined) {
  return !hiddenCategories.has((category ?? '').trim().toLowerCase());
}
