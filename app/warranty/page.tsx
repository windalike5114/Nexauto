import type { Metadata } from "next";
import { HelpCta, InfoPage, InfoSection } from "@/components/info-page";

export const metadata: Metadata = {
  title: "Warranty Policy",
  description: "NexAutoParts warranty policy covering manufacturing defects, claim requirements, exclusions, and New Zealand consumer rights."
};

export default function WarrantyPage() {
  return (
    <InfoPage eyebrow="Warranty Policy" title="Product warranty and claims" intro="NexAutoParts stands behind the quality of the products we supply. Many products are covered by a manufacturer's warranty against defects in materials or workmanship under normal use.">
      <InfoSection title="What Is Covered">
        <p>Warranty generally covers manufacturing defects, material defects, product failures occurring under normal use, and faults caused during production.</p>
      </InfoSection>
      <InfoSection title="What Is Not Covered">
        <p>Warranty does not cover normal wear and tear, incorrect installation, accidents, misuse, improper maintenance, modifications, commercial use beyond intended purpose, environmental damage, or corrosion caused by external factors.</p>
      </InfoSection>
      <InfoSection title="Warranty Claims">
        <p>To submit a warranty claim, contact us with your order number, product name, a description of the issue, and photographs where applicable. Additional information may be requested to assist with assessment.</p>
      </InfoSection>
      <InfoSection title="Warranty Assessment">
        <p>Each claim is assessed individually. If approved, NexAutoParts may repair the product, replace it, provide a refund, or offer an alternative product of equivalent value.</p>
      </InfoSection>
      <InfoSection title="Consumer Rights">
        <p>Nothing in this Warranty Policy limits or excludes any rights you may have under applicable New Zealand consumer protection laws.</p>
      </InfoSection>
      <HelpCta />
    </InfoPage>
  );
}
