export type Plan = { name: string; price: string }

/** The plans, as the app loads them for its pricing page. */
export async function loadPlans(): Promise<Plan[]> {
  return [
    { name: 'Solo', price: '$40' },
    { name: 'Team', price: '$90' },
    { name: 'Fleet', price: '$200' },
  ]
}
