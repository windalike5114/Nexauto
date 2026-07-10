import type { Metadata } from "next";
import { InfoPage, InfoSection } from "@/components/info-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "NexAutoParts privacy policy explaining how customer, order, vehicle, and technical information is collected and used."
};

export default function PrivacyPage() {
  return (
    <InfoPage eyebrow="Privacy Policy" title="Your privacy matters" intro="Last updated: July 2026. This Privacy Policy explains how NexAutoParts collects, uses, stores, and protects your personal information when you visit our website, create an account, or purchase products from us.">
      <InfoSection title="Information We Collect">
        <p>We may collect your name, email address, phone number, delivery address, billing address, order history, payment status, delivery information, and return history.</p>
        <p>To help recommend compatible products, you may voluntarily provide vehicle make, model, year, series, body, or other fitment information.</p>
      </InfoSection>
      <InfoSection title="How We Use Your Information">
        <p>Your information may be used to process orders, deliver products, provide customer support, verify warranty claims, improve our website, improve compatibility recommendations, prevent fraud, comply with legal obligations, and respond to enquiries.</p>
      </InfoSection>
      <InfoSection title="Cookies and Payment Security">
        <p>Our website uses cookies to remember shopping cart contents, save login sessions, analyse traffic, and improve performance.</p>
        <p>NexAutoParts does not store full credit card details. Payments are securely processed through trusted third-party payment providers such as Stripe.</p>
      </InfoSection>
      <InfoSection title="Sharing Information">
        <p>We do not sell your personal information. We may share necessary information with courier companies, payment providers, website hosting providers, support systems, fraud prevention services, and accounting or taxation software.</p>
      </InfoSection>
      <InfoSection title="Your Rights">
        <p>Subject to applicable New Zealand privacy laws, you may request access to your personal information, correction of inaccurate information, account updates, deletion where legally permitted, or withdrawal of marketing consent.</p>
      </InfoSection>
      <InfoSection title="Contact">
        <p>For privacy questions, contact NexAutoParts at support@nexautoparts.co.nz. We are based in Auckland, New Zealand.</p>
      </InfoSection>
    </InfoPage>
  );
}
