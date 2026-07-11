export const emailAddresses = {
  support: process.env.EMAIL_SUPPORT ?? "support@nexautoparts.co.nz",
  sales: process.env.EMAIL_SALES ?? "sales@nexautoparts.co.nz",
  info: process.env.EMAIL_INFO ?? "info@nexautoparts.co.nz",
  admin: process.env.EMAIL_ADMIN ?? "admin@nexautoparts.co.nz",
  accounts: process.env.EMAIL_ACCOUNTS ?? "accounts@nexautoparts.co.nz"
};

export const emailSenders = {
  noreply: process.env.EMAIL_FROM_NOREPLY ?? "NexAutoParts <noreply@nexautoparts.co.nz>",
  orders: process.env.EMAIL_FROM_ORDERS ?? "NexAutoParts <orders@nexautoparts.co.nz>",
  website: process.env.EMAIL_FROM_WEBSITE ?? "NexAutoParts Website <noreply@nexautoparts.co.nz>"
};

export function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://nexautoparts.co.nz").replace(/\/$/, "");
}
