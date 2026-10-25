"use client";

import { useState } from "react";

const QUOTES = [
  { quote: "We stopped losing plans in chat.", author: "Ana, product lead" },
  { quote: "Reviews take minutes now.", author: "Sam, designer" },
];

export function Testimonials() {
  const [index, setIndex] = useState(0);
  const quote = QUOTES[index]!;
  return (
    <section className="px-6 py-16 text-center">
      <blockquote className="text-xl">{quote.quote}</blockquote>
      <p className="mt-2 text-sm text-zinc-500">{quote.author}</p>
      <button
        type="button"
        className="mt-6 min-h-11 px-4 text-sm underline"
        onClick={() => setIndex((index + 1) % QUOTES.length)}
      >
        Next quote
      </button>
    </section>
  );
}
