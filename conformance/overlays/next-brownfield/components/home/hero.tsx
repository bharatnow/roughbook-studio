import { Button } from "@/components/ui/button";

type Props = { title: string; cta: { label: string; href: string } };

export default function Hero({ title, cta }: Props) {
  return (
    <section className="px-6 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-4 text-zinc-600">Everything your team plans, in one quiet place.</p>
      <div className="mt-8">
        <Button href={cta.href}>{cta.label}</Button>
      </div>
    </section>
  );
}
