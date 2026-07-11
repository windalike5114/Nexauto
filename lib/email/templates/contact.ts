import { emailAddresses, emailSenders } from "../config";
import { escapeHtml, renderEmailLayout, renderRows } from "../render";
import { sendEmail } from "../send-email";

export type ContactEmailInput = {
  name: string;
  email: string;
  partOrSku?: string;
  message: string;
  sourcePage: string;
  sourceUrl: string;
  productName?: string;
  productSku?: string;
};

export async function sendContactEmails(input: ContactEmailInput) {
  const partOrSku = input.partOrSku?.trim();
  const submitted = new Date().toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" });
  const internalRows: Array<[string, unknown]> = [
    ["Name", input.name],
    ["Email", input.email],
    ["Part or SKU", partOrSku || "Not provided"],
    ["Message", input.message],
    ["Submitted", submitted],
    ["Source Page", input.sourcePage],
    ["Source URL", input.sourceUrl]
  ];

  if (input.productName) internalRows.push(["Product Name", input.productName]);
  if (input.productSku) internalRows.push(["Product SKU", input.productSku]);

  await sendEmail({
    type: "contact_internal",
    to: emailAddresses.support,
    from: emailSenders.website,
    replyTo: input.email,
    subject: `New website enquiry from ${input.name}`,
    html: renderEmailLayout({
      title: "New NexAutoParts Website Enquiry",
      body: renderRows(internalRows)
    }),
    text: [
      "New NexAutoParts Website Enquiry",
      "",
      `Name: ${input.name}`,
      `Email: ${input.email}`,
      `Part or SKU: ${partOrSku || "Not provided"}`,
      "",
      "Message:",
      input.message,
      "",
      `Submitted: ${submitted}`,
      `Source Page: ${input.sourcePage}`,
      `Source URL: ${input.sourceUrl}`,
      input.productName ? `Product Name: ${input.productName}` : "",
      input.productSku ? `Product SKU: ${input.productSku}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  });

  const partHtml = partOrSku
    ? `<p style="margin:18px 0 6px;font-weight:800">Part or SKU:</p><p style="margin:0 0 14px">${escapeHtml(partOrSku)}</p>`
    : "";

  await sendEmail({
    type: "contact_confirmation",
    to: input.email,
    from: emailSenders.noreply,
    replyTo: emailAddresses.support,
    subject: "We've received your enquiry | NexAutoParts",
    html: renderEmailLayout({
      title: `Hi ${input.name},`,
      intro: "Thanks for contacting NexAutoParts.",
      body: `<p style="margin:0 0 14px">We've received your enquiry and our team will review it as soon as possible.</p>
        ${partHtml}
        <p style="margin:18px 0 6px;font-weight:800">Your message:</p>
        <p style="margin:0 0 14px;white-space:pre-wrap">${escapeHtml(input.message)}</p>
        <p style="margin:18px 0 0">If you need to provide more information, reply directly to this email or contact <a href="mailto:${escapeHtml(emailAddresses.support)}">${escapeHtml(emailAddresses.support)}</a>.</p>`
    }),
    text: [
      `Hi ${input.name},`,
      "",
      "Thanks for contacting NexAutoParts.",
      "We've received your enquiry and our team will review it as soon as possible.",
      "",
      partOrSku ? `Part or SKU:\n${partOrSku}\n` : "",
      "Your message:",
      input.message,
      "",
      "If you need to provide more information, reply directly to this email or contact:",
      emailAddresses.support,
      "",
      "NexAutoParts",
      "Quality Auto Parts for New Zealand Drivers"
    ]
      .filter(Boolean)
      .join("\n")
  });
}
