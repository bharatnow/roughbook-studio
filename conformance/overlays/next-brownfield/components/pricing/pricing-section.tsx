import { getPlans } from "@/lib/plans";
import { PlanCard } from "./plan-card";

// Fetches its plans on the server, as the app's own data, before it renders.
export async function PricingSection() {
  const plans = await getPlans();
  return (
    <section className="grid gap-6 px-6 py-16 sm:grid-cols-3">
      {plans.map((plan) => (
        <PlanCard key={plan.name} plan={plan} />
      ))}
    </section>
  );
}
