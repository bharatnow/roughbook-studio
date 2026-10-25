const FEATURES = [
  { title: "Boards", text: "Every plan on one page." },
  { title: "Reviews", text: "Comments where the work is." },
  { title: "Reports", text: "A week in a glance." },
];

export function Features() {
  return (
    <section className="grid gap-6 px-6 py-16 sm:grid-cols-3">
      {FEATURES.map((feature) => (
        <div key={feature.title}>
          <h2 className="font-semibold">{feature.title}</h2>
          <p className="text-zinc-600">{feature.text}</p>
        </div>
      ))}
    </section>
  );
}
