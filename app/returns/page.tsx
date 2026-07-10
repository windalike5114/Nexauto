import type { Metadata } from "next";
import { HelpCta, InfoPage, InfoSection } from "@/components/info-page";

export const metadata: Metadata = {
  title: "Returns & Refunds",
  description: "NexAutoParts returns and refunds policy for change-of-mind returns, incorrect items, damaged products, and refund processing."
};

export default function ReturnsPage() {
  return (
    <InfoPage eyebrow="Returns & Refunds" title="Shop with confidence" intro="If you are not completely satisfied with your purchase, we are here to help. Please contact us before returning any product so we can guide the process.">
      <InfoSection title="Change of Mind Returns">
        <p>You may request a return within 30 days of receiving your order, provided the product has not been installed or used, remains in its original packaging, includes all accessories, is in resalable condition, and proof of purchase is provided.</p>
        <p>Return shipping costs for change-of-mind returns are the responsibility of the customer unless otherwise agreed.</p>
      </InfoSection>
      <InfoSection title="Incorrect Item Received">
        <p>If we have sent the wrong product, contact us as soon as possible. Once confirmed, we will arrange a replacement or provide a full refund, including any reasonable shipping costs.</p>
      </InfoSection>
      <InfoSection title="Damaged or Faulty Products">
        <p>If your product arrives damaged or develops a manufacturing fault, contact our customer support team with your order number, photos, and a description of the issue.</p>
        <p>Depending on the assessment, we may offer a replacement, repair where applicable, or refund.</p>
      </InfoSection>
      <InfoSection title="Non-Returnable Items">
        <p>Some items cannot be returned for hygiene, safety, or product integrity reasons, including installed products, products showing misuse, final sale items unless faulty, special-order products, or products damaged by incorrect installation.</p>
      </InfoSection>
      <InfoSection title="Refund Processing">
        <p>Approved refunds are issued to the original payment method used during checkout. Please allow 3-10 business days for the refund to appear, depending on your payment provider.</p>
      </InfoSection>
      <HelpCta />
    </InfoPage>
  );
}
