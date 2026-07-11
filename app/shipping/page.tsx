import type { Metadata } from "next";
import { HelpCta, InfoPage, InfoSection } from "@/components/info-page";

export const metadata: Metadata = {
  title: "Shipping Information",
  description: "NexAutoParts shipping information, order processing times, delivery coverage, tracking, and damaged delivery guidance."
};

export default function ShippingPage() {
  return (
    <InfoPage eyebrow="Shipping Information" title="Fast, clear delivery for New Zealand drivers" intro="At NexAutoParts, we understand that getting your vehicle back on the road quickly matters. We aim to process and dispatch orders efficiently while keeping you informed throughout delivery.">
      <InfoSection title="Order Processing">
        <p>Most in-stock orders are processed within 1 business day after payment has been successfully received.</p>
        <p>Orders placed during weekends or public holidays will be processed on the next business day. During promotional events or periods of high demand, processing times may be slightly longer.</p>
      </InfoSection>
      <InfoSection title="Delivery Coverage">
        <p>We currently deliver to addresses throughout New Zealand, including residential addresses, business addresses, rural delivery addresses, and PO Boxes where supported by the selected courier.</p>
        <p>International shipping is not available unless otherwise stated.</p>
      </InfoSection>
      <InfoSection title="Estimated Delivery Times">
        <ul>
          <li>Auckland: 1-2 business days</li>
          <li>North Island: 1-3 business days</li>
          <li>South Island: 2-4 business days</li>
          <li>Rural delivery: additional 1-3 business days</li>
        </ul>
        <p>Delivery estimates are a guide only and may vary due to courier operations, weather, or public holidays.</p>
      </InfoSection>
      <InfoSection title="Shipping Costs and Tracking">
        <p>Standard New Zealand shipping is NZ$8. During launch or promotional campaigns, this shipping charge may be waived and shown as a discount during checkout.</p>
        <p>Once your order has been dispatched, you will receive courier information, a tracking number, and a tracking link where available.</p>
      </InfoSection>
      <InfoSection title="Damaged Deliveries">
        <p>If your parcel arrives damaged, take photographs of the packaging and product, contact us within 48 hours of delivery, and keep all packaging until your claim has been assessed.</p>
      </InfoSection>
      <HelpCta />
    </InfoPage>
  );
}
