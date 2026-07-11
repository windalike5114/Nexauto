import { blobMediaAssets } from "@/lib/blob-media-assets";
import { emailAddresses, getSiteUrl } from "./config";

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderEmailLayout({
  title,
  intro,
  body,
  button
}: {
  title: string;
  intro?: string;
  body: string;
  button?: { label: string; href: string };
}) {
  const siteUrl = getSiteUrl();
  const logo = blobMediaAssets.brand.mainLogo;
  const buttonHtml = button
    ? `<p style="margin:28px 0"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#D71920;color:#ffffff;text-decoration:none;font-weight:800;padding:13px 18px;border-radius:8px">${escapeHtml(button.label)}</a></p>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f8fafc;color:#1b1f24;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
            <tr>
              <td style="padding:24px 28px;border-bottom:1px solid #e5e7eb">
                <img src="${escapeHtml(logo)}" alt="NexAutoParts" width="220" style="display:block;max-width:220px;height:auto" />
              </td>
            </tr>
            <tr>
              <td style="padding:28px">
                <h1 style="margin:0 0 14px;font-size:26px;line-height:1.2;color:#1b1f24">${escapeHtml(title)}</h1>
                ${intro ? `<p style="margin:0 0 22px;color:#51606f;font-size:15px;line-height:1.7">${escapeHtml(intro)}</p>` : ""}
                <div style="font-size:15px;line-height:1.7;color:#1b1f24">${body}</div>
                ${buttonHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px;background:#1b1f24;color:#ffffff">
                <p style="margin:0;font-weight:800">NexAutoParts</p>
                <p style="margin:6px 0 0;color:#d1d5db">Quality Auto Parts for New Zealand Drivers</p>
                <p style="margin:14px 0 0;color:#d1d5db">Support: <a href="mailto:${escapeHtml(emailAddresses.support)}" style="color:#ffffff">${escapeHtml(emailAddresses.support)}</a></p>
                <p style="margin:6px 0 0"><a href="${escapeHtml(siteUrl)}" style="color:#ffffff">${escapeHtml(siteUrl.replace(/^https?:\/\//, ""))}</a></p>
                <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">
                  <a href="${escapeHtml(siteUrl)}/shipping" style="color:#d1d5db">Shipping</a> &nbsp;|&nbsp;
                  <a href="${escapeHtml(siteUrl)}/returns" style="color:#d1d5db">Returns</a> &nbsp;|&nbsp;
                  <a href="${escapeHtml(siteUrl)}/warranty" style="color:#d1d5db">Warranty</a> &nbsp;|&nbsp;
                  <a href="${escapeHtml(siteUrl)}/privacy" style="color:#d1d5db">Privacy</a> &nbsp;|&nbsp;
                  <a href="${escapeHtml(siteUrl)}/terms" style="color:#d1d5db">Terms</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderRows(rows: Array<[string, unknown]>) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    ${rows
      .map(
        ([label, value]) => `<tr>
          <td style="width:155px;padding:9px 0;border-bottom:1px solid #eef2f7;color:#51606f;font-weight:700;vertical-align:top">${escapeHtml(label)}</td>
          <td style="padding:9px 0;border-bottom:1px solid #eef2f7;color:#1b1f24;white-space:pre-wrap">${escapeHtml(value)}</td>
        </tr>`
      )
      .join("")}
  </table>`;
}
