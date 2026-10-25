import { Features } from "@/components/home/features";
import Hero from "@/components/home/hero";
import { Testimonials } from "@/components/home/testimonials";
import { PricingSection } from "@/components/pricing/pricing-section";

export default function Home() {
  return (
    <>
      <Hero title="Plan less, ship more" cta={{ label: "Start free", href: "/pricing" }} />
      <Features />
      <Testimonials />
      <PricingSection />
    </>
  );
}
