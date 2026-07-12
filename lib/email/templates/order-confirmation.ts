import { formatMoney } from "@/lib/catalog";
import { emailAddresses, emailSenders, getSiteUrl } from "../config";
import { escapeHtml, renderEmailLayout, renderRows } from "../render";
import { sendEmail } from "../send-email";

type OrderEmailItem = {
  sku: string;
  productName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  attributes: Record<string, unknown>;
};

export type OrderConfirmationEmailInput = {
  orderId: string;
  orderNumber?: string;
  email: string;
  customerName: string | null;
  createdAt: string;
  currency: string;
  subtotal: number;
  total: number;
  status: string;
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
  items: OrderEmailItem[];
  vehicle?: {
    make: string;
    model: string;
    year: number;
  } | null;
};

export async function sendOrderConfirmationEmail(input: OrderConfirmationEmailInput) {
  const orderNumber = input.orderNumber ?? formatOrderNumber(input.orderId);
  const siteUrl = getSiteUrl();
  const itemRows = input.items
    .map((item) => {
      const sizes = getSizeSummary(item.attributes);
      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #eef2f7">
          <p style="margin:0;font-weight:800">${escapeHtml(item.productName)}</p>
          <p style="margin:4px 0 0;color:#51606f;font-family:monospace;font-size:12px">${escapeHtml(item.sku)}</p>
          ${sizes ? `<p style="margin:4px 0 0;color:#51606f;font-size:12px">${escapeHtml(sizes)}</p>` : ""}
        </td>
        <td align="center" style="padding:12px 8px;border-bottom:1px solid #eef2f7">${item.qty}</td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid #eef2f7">${formatMoney(item.lineTotal)}</td>
      </tr>`;
    })
    .join("");

  const vehicleRows = input.vehicle
    ? renderRows([
        ["Vehicle make", input.vehicle.make],
        ["Vehicle model", input.vehicle.model],
        ["Vehicle year", input.vehicle.year]
      ])
    : "";

  await sendEmail({
    type: "order_confirmation",
    to: input.email,
    from: emailSenders.orders,
    replyTo: emailAddresses.support,
    subject: `Order confirmed - #${orderNumber}`,
    orderId: input.orderId,
    html: renderEmailLayout({
      title: `Order confirmed - #${orderNumber}`,
      intro: "Thanks for your order. Your payment has been received and your order is now being prepared.",
      button: {
        label: "View Order",
        href: `${siteUrl}/account`
      },
      body: `<p style="margin:0 0 18px">Hi ${escapeHtml(input.customerName ?? "there")},</p>
        ${renderRows([
          ["Order number", orderNumber],
          ["Order date", new Date(input.createdAt).toLocaleString("en-NZ")],
          ["Payment status", input.status],
          ["Delivery method", "Standard delivery"]
        ])}
        <h2 style="margin:28px 0 10px;font-size:18px">Order summary</h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
          <thead>
            <tr>
              <th align="left" style="padding:0 0 8px;color:#51606f">Product</th>
              <th align="center" style="padding:0 8px 8px;color:#51606f">Qty</th>
              <th align="right" style="padding:0 0 8px;color:#51606f">Total</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div style="margin-top:18px">${renderRows([
          ["Subtotal", formatMoney(input.subtotal)],
          ["Discount", "Calculated at checkout where applicable"],
          ["Delivery fee", "Calculated at checkout"],
          ["GST", "Included where applicable"],
          ["Total", formatMoney(input.total)]
        ])}</div>
        ${
          input.vehicle
            ? `<h2 style="margin:28px 0 10px;font-size:18px">Vehicle information</h2>${vehicleRows}`
            : ""
        }
        <h2 style="margin:28px 0 10px;font-size:18px">Shipping address</h2>
        <p style="margin:0;white-space:pre-wrap">${escapeHtml(formatAddress(input.shippingAddress))}</p>`
    }),
    text: [
      `Order confirmed - #${orderNumber}`,
      "",
      `Hi ${input.customerName ?? "there"},`,
      "Thanks for your order. Your payment has been received and your order is now being prepared.",
      "",
      `Order number: ${orderNumber}`,
      `Order date: ${new Date(input.createdAt).toLocaleString("en-NZ")}`,
      `Payment status: ${input.status}`,
      "",
      "Order summary:",
      ...input.items.map((item) => `${item.productName} (${item.sku}) x${item.qty} - ${formatMoney(item.lineTotal)}`),
      "",
      `Subtotal: ${formatMoney(input.subtotal)}`,
      `Total: ${formatMoney(input.total)}`,
      input.vehicle ? `Vehicle: ${input.vehicle.make} ${input.vehicle.model} ${input.vehicle.year}` : "",
      "",
      `Support: ${emailAddresses.support}`
    ]
      .filter(Boolean)
      .join("\n")
  });
}

export function formatOrderNumber(orderId: string) {
  const digits = orderId.replace(/\D/g, "").slice(-5).padStart(5, "0");
  return `NEX${digits}`;
}

function getSizeSummary(attributes: Record<string, unknown>) {
  const driver = attributes.driver_length;
  const passenger = attributes.passenger_length;
  const rear = attributes.rear_length;
  return [driver ? `Driver ${driver}` : "", passenger ? `Passenger ${passenger}` : "", rear ? `Rear ${rear}` : ""]
    .filter(Boolean)
    .join(" / ");
}

function formatAddress(address: Record<string, unknown>) {
  const line1 = address.line1;
  const line2 = address.line2;
  const city = address.city;
  const postalCode = address.postal_code;
  const country = address.country;
  return [line1, line2, city, postalCode, country].filter(Boolean).join("\n") || "Not provided";
}
