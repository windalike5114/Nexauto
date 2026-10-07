import { formatMoney } from "@/lib/catalog";
import { emailAddresses, emailSenders, getSiteUrl } from "../config";
import { escapeHtml, renderEmailLayout, renderRows } from "../render";
import { sendEmail } from "../send-email";

type NewOrderAlertItem = {
  sku: string;
  productName: string;
  qty: number;
  lineTotal: number;
  attributes: Record<string, unknown>;
};

export type NewOrderAlertInput = {
  orderId: string;
  orderNumber: string;
  customerEmail: string | null;
  customerName: string | null;
  createdAt: string;
  currency: string;
  subtotal: number;
  total: number;
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
  items: NewOrderAlertItem[];
  vehicle?: {
    make: string;
    model: string;
    year: number;
    series?: string;
    body?: string;
  } | null;
  emailEventId?: string | null;
};

export async function sendNewOrderAlertEmail(input: NewOrderAlertInput) {
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

  const vehicleRows = input.vehicle ? renderRows(buildVehicleRows(input.vehicle)) : "";

  await sendEmail({
    type: "order_internal_notification",
    to: emailAddresses.orders,
    from: emailSenders.orders,
    replyTo: emailAddresses.support,
    subject: `New paid order - ${input.orderNumber}`,
    orderId: input.orderId,
    emailEventId: input.emailEventId,
    html: renderEmailLayout({
      title: `New paid order - ${input.orderNumber}`,
      intro: "A new paid order has been received and is ready for review in admin.",
      button: {
        label: "Open order in admin",
        href: `${siteUrl}/admin/orders/${input.orderId}`
      },
      body: `${renderRows([
        ["Order number", input.orderNumber],
        ["Order date", new Date(input.createdAt).toLocaleString("en-NZ")],
        ["Customer", input.customerName ?? "Guest checkout"],
        ["Customer email", input.customerEmail ?? "Not provided"],
        ["Subtotal", formatMoney(input.subtotal)],
        ["Total", formatMoney(input.total)]
      ])}
      <h2 style="margin:28px 0 10px;font-size:18px">Items</h2>
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
      ${
        input.vehicle
          ? `<h2 style="margin:28px 0 10px;font-size:18px">Vehicle information</h2>${vehicleRows}`
          : ""
      }
      <h2 style="margin:28px 0 10px;font-size:18px">Shipping address</h2>
      <p style="margin:0;white-space:pre-wrap">${escapeHtml(formatAddress(input.shippingAddress))}</p>
      <h2 style="margin:28px 0 10px;font-size:18px">Billing address</h2>
      <p style="margin:0;white-space:pre-wrap">${escapeHtml(formatAddress(input.billingAddress))}</p>`
    }),
    text: [
      `New paid order - ${input.orderNumber}`,
      "",
      `Order date: ${new Date(input.createdAt).toLocaleString("en-NZ")}`,
      `Customer: ${input.customerName ?? "Guest checkout"}`,
      `Customer email: ${input.customerEmail ?? "Not provided"}`,
      "",
      "Items:",
      ...input.items.map((item) => `${item.productName} (${item.sku}) x${item.qty} - ${formatMoney(item.lineTotal)}`),
      "",
      `Subtotal: ${formatMoney(input.subtotal)}`,
      `Total: ${formatMoney(input.total)}`,
      input.vehicle ? `Vehicle: ${formatVehicle(input.vehicle)}` : "",
      "",
      `Admin: ${siteUrl}/admin/orders/${input.orderId}`
    ]
      .filter(Boolean)
      .join("\n")
  });
}

function formatVehicle(vehicle: NonNullable<NewOrderAlertInput["vehicle"]>) {
  return [`${vehicle.make} ${vehicle.model} ${vehicle.year}`, vehicle.series, vehicle.body].filter(Boolean).join(" · ");
}

function buildVehicleRows(vehicle: NonNullable<NewOrderAlertInput["vehicle"]>): Array<[string, unknown]> {
  const rows: Array<[string, unknown]> = [
    ["Vehicle make", vehicle.make],
    ["Vehicle model", vehicle.model],
    ["Vehicle year", vehicle.year]
  ];
  if (vehicle.series) rows.push(["Generation", vehicle.series]);
  if (vehicle.body) rows.push(["Body / chassis", vehicle.body]);
  return rows;
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
  const suburb = address.suburb;
  const city = address.city;
  const region = address.state ?? address.region;
  const postalCode = address.postal_code ?? address.postcode;
  const country = address.country;
  return [line1, line2, suburb, city, region, postalCode, country].filter(Boolean).join("\n") || "Not provided";
}
