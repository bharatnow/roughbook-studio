import type { Plan } from '../data/plans'

export function Pricing({ plans }: { plans: Plan[] }) {
  return (
    <section className="plans" aria-label="Plans">
      {plans.map((plan) => (
        <article className="plan" key={plan.name}>
          <h2>{plan.name}</h2>
          <p>{plan.price} a week</p>
        </article>
      ))}
    </section>
  )
}
