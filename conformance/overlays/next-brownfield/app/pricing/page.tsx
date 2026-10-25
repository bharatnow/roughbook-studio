import { Faq } from "@/components/pricing/faq";
import { PricingSection } from "@/components/pricing/pricing-section";

export const metadata = { title: "Pricing" };

export default function Pricing() {
  return (
    <>
      <PricingSection />
      <Faq />
    </>
  );
}
