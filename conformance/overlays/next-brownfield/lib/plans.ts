import plans from "@/data/plans.json";

export type Plan = { name: string; price: string };

// The app's own data, read on the server and cached, as a database call would be.
export async function getPlans(): Promise<Plan[]> {
  "use cache";
  return plans;
}
