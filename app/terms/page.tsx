import type { Metadata } from "next";
import { InfoPage, InfoSection } from "@/components/info-page";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "NexAutoParts terms and conditions covering website use, orders, pricing, payment, shipping, returns, warranty, and vehicle compatibility."
};

export default function TermsPage() {
  return (
    <InfoPage eyebrow="Terms & Conditions" title="Website terms" intro="Effective date: July 2026. By accessing or using the NexAutoParts website, you agree to these Terms & Conditions.">
      <InfoSection title="Website Use">
        <p>You agree to use the website only for lawful purposes. You must not use the website for fraudulent activity, interfere with website operation, attempt unauthorised access, upload malicious software, or misuse customer accounts.</p>
      </InfoSection>
      <InfoSection title="Product Information and Compatibility">
        <p>We strive to ensure product descriptions, images, and specifications are accurate. Images are for illustration only, colours may vary, specifications may change, and vehicle compatibility should always be confirmed before installation.</p>
      </InfoSection>
      <InfoSection title="Pricing, Orders, and Payment">
        <p>All prices are displayed in New Zealand Dollars unless otherwise stated. We reserve the right to correct pricing errors before accepting an order.</p>
        <p>Orders will not be dispatched until payment has been successfully authorised.</p>
      </InfoSection>
      <InfoSection title="Shipping, Returns, and Warranty">
        <p>Shipping times are estimates only. Returns are subject to our Returns & Refunds Policy, and warranty coverage is governed by our Warranty Policy.</p>
      </InfoSection>
      <InfoSection title="Consumer Rights">
        <p>Nothing in these Terms limits your rights under the Consumer Guarantees Act 1993, the Fair Trading Act 1986, or any other applicable New Zealand legislation.</p>
      </InfoSection>
      <InfoSection title="Governing Law">
        <p>These Terms & Conditions are governed by the laws of New Zealand. Any disputes shall be subject to the exclusive jurisdiction of the New Zealand courts.</p>
      </InfoSection>
    </InfoPage>
  );
}
