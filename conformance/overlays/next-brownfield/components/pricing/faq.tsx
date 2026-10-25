const QUESTIONS = [
  { q: "Can I cancel any time?", a: "Yes, from your account." },
  { q: "Is there a free plan?", a: "Yes, for teams of up to three." },
];

export function Faq() {
  return (
    <section className="px-6 py-16">
      <h2 className="text-2xl font-semibold">Questions</h2>
      {QUESTIONS.map((item) => (
        <details key={item.q} className="mt-4">
          <summary className="min-h-11">{item.q}</summary>
          <p className="text-zinc-600">{item.a}</p>
        </details>
      ))}
    </section>
  );
}
