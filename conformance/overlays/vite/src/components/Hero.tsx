export function Hero({ title, lead }: { title: string; lead: string }) {
  return (
    <section className="hero">
      <h1>{title}</h1>
      <p>{lead}</p>
    </section>
  )
}
