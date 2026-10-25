const PEOPLE = ["Ana", "Sam", "Lee"];

export function Team() {
  return (
    <section className="px-6 py-16">
      <h2 className="text-2xl font-semibold">The team</h2>
      <ul className="mt-4 flex gap-4">
        {PEOPLE.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </section>
  );
}
