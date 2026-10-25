import type { Plan } from "@/lib/plans";

export function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-6">
      <h3 className="font-semibold">{plan.name}</h3>
      <p className="mt-2 text-3xl">{plan.price}</p>
    </div>
  );
}
